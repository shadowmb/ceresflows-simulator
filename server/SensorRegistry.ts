/**
 * SensorRegistry - Loads and manages device/sensor templates
 * 
 * Provides sensor metadata including pin requirements and response formats
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM Shim
// ESM Shim (Hybrid for CJS bundle & ESM Dev)
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

export interface SensorOutput {
    key: string;
    label: string;
    unit: string;
}

export interface SensorCommand {
    hardwareCmd: string;
    valuePath?: string;
    sourceUnit?: string;
    outputs?: SensorOutput[];
}

export interface SensorPin {
    name: string;       // "Signal", "TRIG", "ECHO", "RX", "TX"
    type: string;       // "ANALOG_IN", "DIGITAL_IN", "DIGITAL_OUT"
}

// Minimal definition matching Config V2 Schema
export interface SensorTemplate {
    id: string;
    name: string;
    description: string;
    category: 'SENSOR' | 'ACTUATOR';
    parentTag?: string;
    isParentTemplate?: boolean;

    // Config V2 Structure
    hardware?: {
        interface: string;
        pins: SensorPin[];
        capabilities?: string[];
    };
    measurements?: Record<string, {
        unit: string;
        rawUnit?: string;
        limits?: { min: number; max: number };
    }>;
    commands: Record<string, {
        hwCmd: string;
        params?: any;
        valuePath?: string;
        outputs?: SensorOutput[]; // Legacy
        responseProcessing?: {    // Bus sensors (UART/I2C): decode byte arrays
            type: string;
            offset?: number;
            length?: number;
            endian?: string;
            signed?: boolean;
            divisor?: number;
        };
    }>;

    // Legacy Root Fields (Config V1)
    pins?: SensorPin[]; // Fallback
    hardwareLimits?: { min: number; max: number; unit: string };
    initialState?: { value: number };
}

export class SensorRegistry {
    private sensors: Map<string, SensorTemplate> = new Map();
    private configPath: string;

    constructor() {
        this.configPath = this.resolveConfigPath();
        this.loadSensors();
    }

    private resolveConfigPath(): string {
        // 1. Standalone/Portable Mode (Local config folder in CWD)
        const cwd = process.cwd();
        const localConfig = path.join(cwd, 'config', 'devices');
        if (fs.existsSync(localConfig)) return localConfig;

        // 2. Search relative to this file (e.g. if in /server/ folder)
        const localRelPath = path.resolve(_dirname, '../config/devices');
        if (fs.existsSync(localRelPath)) return localRelPath;

        // 3. Dev Mode fallback (Original repository structure)
        const devPath = path.resolve(_dirname, '../../backend/config/devices');
        if (fs.existsSync(devPath)) return devPath;

        return localConfig;
    }

    private loadSensors(): void {
        try {
            if (!fs.existsSync(this.configPath)) {
                console.warn('[Registry] Devices path not found:', this.configPath);
                return;
            }

            this.sensors.clear();
            this.scanDirectory(this.configPath);
            console.log(`[Registry] Total sensors/devices: ${this.sensors.size}`);
        } catch (e) {
            console.error('[Registry] Error loading sensors:', e);
        }
    }

    private scanDirectory(dir: string): void {
        const items = fs.readdirSync(dir, { withFileTypes: true });

        for (const item of items) {
            const fullPath = path.join(dir, item.name);

            if (item.isDirectory()) {
                this.scanDirectory(fullPath);
            } else if (item.name.endsWith('.json')) {
                try {
                    const content = fs.readFileSync(fullPath, 'utf-8');
                    const template = JSON.parse(content) as SensorTemplate;

                    if (template.id) {
                        this.sensors.set(template.id, template);
                        console.log(`[Registry] Loaded: ${template.id} (${template.name || 'No Name'})`);
                    }
                } catch (e) {
                    console.error(`[Registry] Failed to load ${fullPath}:`, e);
                }
            }
        }
    }

    getSensor(id: string): SensorTemplate | undefined {
        return this.sensors.get(id);
    }

    listSensors(): { id: string; name: string; category: string; pinCount: number, pins: SensorPin[], parentTag?: string }[] {
        return Array.from(this.sensors.values()).map(s => {
            let pinCount = 0;
            let pins: SensorPin[] = [];

            if (s.hardware?.pins) {
                pins = s.hardware.pins;
                pinCount = pins.length;
            } else if (s.pins) {
                pins = s.pins;
                pinCount = pins.length;
            }

            return {
                id: s.id,
                name: s.name,
                category: s.category,
                pinCount,
                pins,
                parentTag: s.parentTag
            };
        });
    }

    getSensorsByCategory(category: 'SENSOR' | 'ACTUATOR'): SensorTemplate[] {
        return Array.from(this.sensors.values()).filter(s => s.category === category);
    }

    getHardwareCommand(sensorId: string): string | undefined {
        const sensor = this.sensors.get(sensorId);
        if (!sensor) return undefined;

        // V2: Check commands.READ.hwCmd
        if (sensor.commands?.READ?.hwCmd) return sensor.commands.READ.hwCmd;
        if (sensor.commands?.TOGGLE?.hwCmd) return sensor.commands.TOGGLE.hwCmd;

        // V2: Fallback to hardware.capabilities (sometimes used as cmd)
        if (sensor.hardware?.capabilities && sensor.hardware.capabilities.length > 0) {
            return sensor.hardware.capabilities[0];
        }

        return undefined;
    }

    getAllRawUnits(sensorId: string): Record<string, string> {
        const sensor = this.sensors.get(sensorId);
        if (!sensor?.measurements) return {};

        const units: Record<string, string> = {};
        for (const [key, meta] of Object.entries(sensor.measurements)) {
            units[key] = meta.rawUnit || meta.unit;
        }
        return units;
    }

    getAllLimits(sensorId: string): Record<string, { min?: number; max?: number }> {
        const sensor = this.sensors.get(sensorId);
        const limits: Record<string, { min?: number; max?: number }> = {};

        if (!sensor) return limits;

        // V2: Check measurements limits
        if (sensor.measurements) {
            for (const [key, meta] of Object.entries(sensor.measurements)) {
                if (meta.limits) {
                    limits[key] = { min: meta.limits.min, max: meta.limits.max };
                }
            }
        }

        // V2: Check hardware global limits
        if (sensor.hardwareLimits) {
            limits['value'] = sensor.hardwareLimits;
        }

        return limits;
    }

    getRawUnit(sensorId: string): string | undefined {
        const sensor = this.sensors.get(sensorId);
        if (!sensor) return undefined;

        if (sensor.measurements) {
            const first = Object.values(sensor.measurements)[0];
            return first?.rawUnit || first?.unit;
        }
        return undefined;
    }

    getOutputKeys(sensorId: string): string[] {
        const sensor = this.sensors.get(sensorId);
        if (!sensor) return ['value'];

        // V2: Use keys from measurements object
        if (sensor.measurements) {
            const keys = Object.keys(sensor.measurements);
            if (keys.length > 0) return keys;
        }

        // V1: Legacy outputs array
        const readCmd = sensor.commands?.READ;
        if (readCmd?.outputs) {
            return readCmd.outputs.map(o => o.key);
        }

        return ['value'];
    }
}
