/**
 * ControllerRegistry - Loads and manages controller templates
 * 
 * Provides controller metadata including pins and capabilities
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ESM Shim
// ESM Shim (Hybrid for CJS bundle & ESM Dev)
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

export interface ControllerPort {
    id: string;          // "D2", "A0"
    label: string;       // "Digital Pin 2"
    type: 'digital' | 'analog';
    pin: number;         // GPIO number
    pwm?: boolean;
    reserved?: boolean;
    interface?: string;  // "uart", "spi", "i2c"
}

export interface ControllerTemplate {
    key: string;
    label: string;
    description: string;
    architecture: string;
    ports: ControllerPort[];
    pin_counts: {
        digital: number;
        analog: number;
        pwm: number;
    };
    electrical_specs?: {
        analog_resolution?: string;  // "10-bit", "12-bit", "14-bit"
        logic_voltage?: string;
        adc_range?: string;
    };
}

export class ControllerRegistry {
    private controllers: Map<string, ControllerTemplate> = new Map();
    private configPath: string;

    constructor() {
        this.configPath = this.resolveConfigPath();
        this.loadControllers();
    }

    private resolveConfigPath(): string {
        // 1. Standalone/Portable Mode (Local config folder in CWD)
        const cwd = process.cwd();
        const localConfig = path.join(cwd, 'config', 'controllers');
        if (fs.existsSync(localConfig)) return localConfig;

        // 2. Search relative to this file (e.g. if in /server/ folder)
        const localRelPath = path.resolve(_dirname, '../config/controllers');
        if (fs.existsSync(localRelPath)) return localRelPath;

        // 3. Dev Mode fallback (Original repository structure)
        const devPath = path.resolve(_dirname, '../../backend/config/controllers');
        if (fs.existsSync(devPath)) return devPath;

        return localConfig; // Final fallback to CWD path
    }

    private loadControllers(): void {
        try {
            if (!fs.existsSync(this.configPath)) {
                console.warn('[Registry] Controllers path not found:', this.configPath);
                return;
            }

            const files = fs.readdirSync(this.configPath).filter(f => f.endsWith('.json'));

            for (const file of files) {
                try {
                    const content = fs.readFileSync(path.join(this.configPath, file), 'utf-8');
                    const template = JSON.parse(content) as ControllerTemplate;
                    this.controllers.set(template.key, template);
                    console.log(`[Registry] Loaded controller: ${template.key}`);
                } catch (e) {
                    console.error(`[Registry] Failed to load ${file}:`, e);
                }
            }

            console.log(`[Registry] Total controllers: ${this.controllers.size}`);
        } catch (e) {
            console.error('[Registry] Error loading controllers:', e);
        }
    }

    getController(key: string): ControllerTemplate | undefined {
        return this.controllers.get(key);
    }

    listControllers(): { key: string; label: string }[] {
        return Array.from(this.controllers.values()).map(c => ({
            key: c.key,
            label: c.label
        }));
    }

    getAvailablePins(controllerKey: string): ControllerPort[] {
        const controller = this.controllers.get(controllerKey);
        if (!controller) return [];

        // Return non-reserved pins
        return controller.ports.filter(p => !p.reserved);
    }

    getAllPins(controllerKey: string): ControllerPort[] {
        const controller = this.controllers.get(controllerKey);
        return controller?.ports || [];
    }

    /**
     * Get ADC max value based on controller's analog resolution
     * E.g., "10-bit" → 1023, "12-bit" → 4095, "14-bit" → 16383
     */
    getAdcMaxValue(controllerKey: string): number {
        const controller = this.controllers.get(controllerKey);
        const resolution = controller?.electrical_specs?.analog_resolution || '10-bit';

        // Parse bits from string like "14-bit"
        const match = resolution.match(/(\d+)-bit/);
        const bits = match ? parseInt(match[1]) : 10;

        return Math.pow(2, bits) - 1;
    }
}
