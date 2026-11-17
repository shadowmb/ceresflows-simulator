/**
 * PinAssignmentManager - Manages sensor-to-pin assignments
 * 
 * Handles:
 * - Assigning sensors to specific pins
 * - Storing sensor values
 * - Looking up sensor by pin when command arrives
 * - Simulating sensor behavior (noise, waves)
 */

import { SensorRegistry, SensorTemplate } from './SensorRegistry.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ESM Shim
// ESM Shim (Hybrid for CJS bundle & ESM Dev)
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

export interface SimulationConfig {
    enabled: boolean;
    mode: 'random' | 'wave' | 'spike';
    min: number;
    max: number;
    interval?: number;
}

export interface PinAssignment {
    id: string;                 // Unique ID for this assignment
    sensorId: string;           // Template ID: "dfrobot_ph_pro"
    pins: string[];             // Assigned pins: ["A0_14"] or ["D2_2", "D3_3"]
    values: Record<string, number>;  // Current values: { ph: 6.5 } or { temp: 24, humidity: 60 }
    calibrationPoints?: { raw: number, value: number }[]; // Raw <-> Value mapping
    multiCalibration?: Record<number, { raw: number, value: number }[]>; // NEW: Multi-channel calibration for Mothers
    multiValues?: Record<number, number>; // NEW: Multi-channel raw values for Mothers
    indexLabels?: Record<number, string>; // NEW: Custom labels for channels
    simConfig?: SimulationConfig; // NEW: Simulation/Generator Mode
    orderIndex?: number;
    userLabel?: string;         // NEW: Custom User Name
    addr?: string;              // NEW: I2C Address (e.g. 0x44)
    slaveId?: number;           // NEW: Modbus Slave ID
}

export interface AssignedSensorInfo {
    sensorId: string;
    sensorName: string;
    sensorCategory?: string;
    pins: string[];
    hardwareCmd: string;
    values: Record<string, number>;
    limits?: { min: number; max: number; unit: string };
    perKeyLimits?: Record<string, { min?: number; max?: number }>;
    rawUnit?: string;
    units?: Record<string, string>; // Per-key units (e.g. { temp: 'C', humidity: '%' })
    calibrationPoints?: { raw: number, value: number }[];
    multiCalibration?: Record<number, { raw: number, value: number }[]>;
    multiValues?: Record<number, number>;
    indexLabels?: Record<number, string>;
    isParentTemplate?: boolean;
    parentTag?: string;
    simConfig?: SimulationConfig;
    orderIndex?: number;
    userLabel?: string;
    addr?: string;
    slaveId?: number;
}

export class PinAssignmentManager {
    private assignments: PinAssignment[] = [];
    private configPath: string = '';

    constructor(private sensorRegistry: SensorRegistry) {
        // Default init with empty path, waiting for setConfigProfile
    }

    /**
     * Set the current profile ID for persistence
     */
    setConfigProfile(profileId: string) {
        const safeId = profileId.replace(/[^a-z0-9_\-]/gi, '_');
        const isPkg = (process as any).pkg !== undefined;
        const rootDir = isPkg ? path.dirname(process.execPath) : path.join(_dirname, '..');
        this.configPath = path.join(rootDir, 'data', `assignments_${safeId}.json`);

        if (!fs.existsSync(path.dirname(this.configPath))) {
            fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        }

        console.log(`[PinManager] Switched config to profile: ${profileId}`);
        this.loadConfig();
    }

    setSimulation(pin: string, config: SimulationConfig) {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            assignment.simConfig = config;
            this.saveConfig();
        }
    }

    setCalibration(pin: string, points: { raw: number, value: number }[]) {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            assignment.calibrationPoints = points;
            this.saveConfig();
        }
    }

    setLabel(pin: string, label: string) {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            assignment.userLabel = label;
            this.saveConfig();
        }
    }

    assignSensor(sensorId: string, pins: string[], addr?: string, slaveId?: number): boolean {
        const sensor = this.sensorRegistry.getSensor(sensorId);
        if (!sensor) return false;

        const values: Record<string, number> = {};
        const outputKeys = this.sensorRegistry.getOutputKeys(sensorId);
        const initialValue = sensor.initialState?.value ?? 0;
        for (const key of outputKeys) values[key] = initialValue;

        const assignment: PinAssignment = {
            id: Math.random().toString(36).substring(2, 9),
            sensorId,
            pins,
            values,
            orderIndex: this.assignments.length,
            addr,
            slaveId
        };

        this.assignments.push(assignment);
        this.saveConfig();
        return true;
    }

    unassignPin(pinOrId: string): void {
        const key = String(pinOrId);
        this.assignments = this.assignments.filter(a => a.id !== key && !a.pins.includes(key));
        this.saveConfig();
    }

    reorderAssignments(order: string[]): void {
        const sorted: PinAssignment[] = [];
        order.forEach((id, index) => {
            const assignment = this.assignments.find(a => a.id === id);
            if (assignment) {
                assignment.orderIndex = index;
                sorted.push(assignment);
            }
        });

        // Add any missing ones at the end
        this.assignments.forEach(a => {
            if (!sorted.find(s => s.id === a.id)) {
                a.orderIndex = sorted.length;
                sorted.push(a);
            }
        });

        this.assignments = sorted;
        this.saveConfig();
    }

    /**
     * Finds an assignment that contains ANY of the provided pins.
     * Useful for UART (RX/TX) or I2C (SDA/SCL) resolution.
     */
    getBusAssignment(pins: (string | number)[]): PinAssignment | undefined {
        for (const p of pins) {
            const assignment = this.getAssignment(p);
            if (assignment) return assignment;
        }
        return undefined;
    }

    getAssignment(rawPin: string | number): PinAssignment | undefined {
        const pin = String(rawPin);

        // 1. Try exact ID match
        let found = this.assignments.find(a => a.id === pin);
        if (found) return found;

        // 2. Try exact match in pins array
        found = this.assignments.find(a => a.pins.includes(pin));
        if (found) return found;

        // 3. Smart match (suffix/prefix)
        return this.assignments.find(a =>
            a.pins.some(p => p.endsWith(`_${pin}`) || p.startsWith(`${pin}_`) || p === `D${pin}`)
        );
    }

    getSensorForPin(pin: string): SensorTemplate | undefined {
        const assignment = this.getAssignment(pin);
        return assignment ? this.sensorRegistry.getSensor(assignment.sensorId) : undefined;
    }

    setValue(pin: string, key: string, value: number, persist = true): void {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            assignment.values[key] = value;
            if (persist) {
                this.saveConfig();
            }
        }
    }

    setMultiValue(pin: string, index: number, value: number): void {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            if (!assignment.multiValues) assignment.multiValues = {};
            assignment.multiValues[index] = value;
            this.saveConfig();
        }
    }

    removeMultiValue(pin: string, index: number): void {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            if (assignment.multiValues && assignment.multiValues[index] !== undefined) {
                delete assignment.multiValues[index];
            }
            if (assignment.indexLabels && assignment.indexLabels[index] !== undefined) {
                delete assignment.indexLabels[index];
            }
            if (assignment.multiCalibration && assignment.multiCalibration[index] !== undefined) {
                delete assignment.multiCalibration[index];
            }
            this.saveConfig();
        }
    }

    setMultiLabel(pin: string, index: number, label: string): void {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            if (!assignment.indexLabels) assignment.indexLabels = {};
            assignment.indexLabels[index] = label;
            this.saveConfig();
        }
    }

    setMultiCalibration(pin: string, index: number, points: { raw: number, value: number }[]): void {
        const assignment = this.getAssignment(pin);
        if (assignment) {
            if (!assignment.multiCalibration) assignment.multiCalibration = {};
            assignment.multiCalibration[index] = points;
            this.saveConfig();
        }
    }

    getValues(pin: string): Record<string, number> | undefined {
        const assignment = this.getAssignment(pin);
        if (!assignment) return undefined;

        if (assignment.simConfig && assignment.simConfig.enabled) {
            const { min, max, mode } = assignment.simConfig;
            let keys = Object.keys(assignment.values);
            if (keys.length === 0) {
                keys = ['value'];
                assignment.values['value'] = 0;
            }

            const newValues = { ...assignment.values };
            for (const key of keys) {
                let val = newValues[key];
                if (mode === 'random') val = Math.random() * (max - min) + min;
                else if (mode === 'wave') {
                    const time = Date.now() / 1000;
                    val = min + (max - min) * 0.5 * (1 + Math.sin(time));
                }
                newValues[key] = val;
            }
            assignment.values = newValues;
            return newValues;
        }

        return assignment.values;
    }

    getAllAssignments(): AssignedSensorInfo[] {
        return this.assignments.map(assignment => {
            const sensor = this.sensorRegistry.getSensor(assignment.sensorId);
            const hwCmd = this.sensorRegistry.getHardwareCommand(assignment.sensorId) || '';
            const isAnalog = hwCmd === 'ANALOG';

            return {
                sensorId: assignment.sensorId,
                sensorName: sensor?.name || 'Unknown',
                sensorCategory: sensor?.category,
                pins: assignment.pins,
                hardwareCmd: hwCmd,
                values: assignment.values,
                limits: isAnalog ? { min: 0, max: 1023, unit: 'adc' } : sensor?.hardwareLimits,
                perKeyLimits: this.sensorRegistry.getAllLimits(assignment.sensorId),
                rawUnit: isAnalog ? 'adc' : this.sensorRegistry.getRawUnit(assignment.sensorId),
                units: isAnalog ? { value: 'adc' } : this.sensorRegistry.getAllRawUnits(assignment.sensorId),
                calibrationPoints: assignment.calibrationPoints,
                multiCalibration: assignment.multiCalibration,
                multiValues: assignment.multiValues,
                indexLabels: assignment.indexLabels,
                isParentTemplate: sensor?.isParentTemplate,
                parentTag: sensor?.parentTag,
                simConfig: assignment.simConfig,
                orderIndex: assignment.orderIndex,
                userLabel: assignment.userLabel,
                addr: assignment.addr,
                slaveId: assignment.slaveId
            };
        }).sort((a, b) => (a.orderIndex ?? 9999) - (b.orderIndex ?? 9999));
    }

    clear(): void {
        this.assignments = [];
        console.log('[PinManager] Cleared all assignments');
    }

    exportConfig(): any[] {
        return this.assignments.map(assignment => ({
            id: assignment.id,
            sensorId: assignment.sensorId,
            pins: assignment.pins,
            values: assignment.values,
            calibrationPoints: assignment.calibrationPoints,
            multiCalibration: assignment.multiCalibration,
            multiValues: assignment.multiValues,
            indexLabels: assignment.indexLabels,
            simConfig: assignment.simConfig,
            orderIndex: assignment.orderIndex,
            userLabel: assignment.userLabel,
            addr: assignment.addr,
            slaveId: assignment.slaveId
        }));
    }

    importConfig(config: any[]): void {
        this.clear();
        if (!Array.isArray(config)) return;

        for (const item of config) {
            this.assignSensor(item.sensorId, item.pins, item.addr, item.slaveId);
            const assignment = this.assignments[this.assignments.length - 1];
            if (assignment) {
                if (item.id) assignment.id = item.id;
                if (item.values) assignment.values = { ...assignment.values, ...item.values };
                if (item.calibrationPoints) assignment.calibrationPoints = item.calibrationPoints;
                if (item.multiCalibration) assignment.multiCalibration = item.multiCalibration;
                if (item.multiValues) assignment.multiValues = item.multiValues;
                if (item.indexLabels) assignment.indexLabels = item.indexLabels;
                if (item.simConfig) assignment.simConfig = item.simConfig;
                if (item.orderIndex !== undefined) assignment.orderIndex = item.orderIndex;
                if (item.userLabel) assignment.userLabel = item.userLabel;
            }
        }
    }

    // ============ Persistence ============

    setConfigId(controllerId: string) {
        const safeId = controllerId.replace(/[^a-zA-Z0-9_-]/g, '_');
        // Point to the local 'data' folder
        this.configPath = path.join(_dirname, `../data/assignments_${safeId}.json`);

        const dataDir = path.dirname(this.configPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }

        console.log(`[PinManager] Set config path: ${this.configPath}`);
        this.loadConfig();
    }

    reset() {
        this.clear();
        this.saveConfig();
        console.log('[PinManager] Reset configuration');
    }

    public saveConfig() {
        if (!this.configPath) {
            console.warn('[PinManager] saveConfig skipped: No config path set');
            return;
        }
        try {
            const data = this.exportConfig();
            fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2));
            console.log(`[PinManager] Config saved to: ${this.configPath}`);
        } catch (e) {
            console.error('[PinManager] Error saving config:', e);
        }
    }

    private loadConfig() {
        if (!this.configPath) return;
        if (!fs.existsSync(this.configPath)) {
            this.clear();
            return;
        }

        try {
            const content = fs.readFileSync(this.configPath, 'utf-8');
            const data = JSON.parse(content);
            this.importConfig(data);
            console.log(`[PinManager] Loaded ${data.length} assignments from config`);
        } catch (e) {
            console.error('[PinManager] Error loading config:', e);
        }
    }
}
