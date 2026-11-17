import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DeviceState } from './DeviceState.js';
import { PinAssignmentManager } from './PinAssignmentManager.js';

// ESM Shim
// ESM Shim (Hybrid for CJS bundle & ESM Dev)
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

export interface ScenarioStep {
    id: string;
    pin: string;        // Target Pin (e.g., "A0")
    key?: string;       // Target Key (e.g., "value", "ph") - detaults to first key
    startDelay: number; // Seconds to wait before starting
    startValue: number;
    endValue: number;
    stepSize: number;
    stepInterval: number; // ms
}

export interface Scenario {
    id: string;
    name: string;
    description?: string;
    steps: ScenarioStep[];
}

export interface ClosedLoopRule {
    id: string;
    name: string;
    enabled: boolean;
    actuatorPin: string;    // Relay or Actuator pin, e.g. "D2"
    targetPin: string;      // Sensor pin, e.g. "A0"
    targetKey?: string;     // Sensor value key, e.g. "value"
    onRatePerSec: number;   // Delta per second when actuator is ON (e.g. +2.0 for moisture rise)
    offRatePerSec: number;  // Delta per second when actuator is OFF (e.g. 0.15 for drying decay)
    minLimit: number;       // Lower limit clamp (e.g. 22.0)
    maxLimit: number;       // Upper limit clamp (e.g. 82.0)
    noise?: number;         // Small random jitter (e.g. 0.1)
}

export class ScenarioEngine {
    private pinManager: PinAssignmentManager;
    private deviceState?: DeviceState;
    private scenariosFile: string;
    private closedLoopFile: string;
    private scenarios: Scenario[] = [];
    private closedLoopRules: ClosedLoopRule[] = [];

    private activeScenario: Scenario | null = null;
    private startTime: number = 0;
    private intervalId: NodeJS.Timeout | null = null;

    private reactiveIntervalId: NodeJS.Timeout | null = null;
    private lastReactiveTick: number = Date.now();

    // Hardcoded map of Sensor ID -> Primary Output Key
    // This ensures consistency when a sensor has no initial value.
    private SENSOR_KEYS: Record<string, string> = {
        'dfrobot_a02yyuw': 'distance',
        'a02yyuw_ultrasonic': 'raw_value',
        'dfrobot_ph_pro': 'raw_voltage',
        'dfrobot_ec_k1': 'raw_voltage',
        'dfrobot_tds_sen0244': 'tds_value',
        'capacitive_soil_moisture': 'raw_value',
        'noncontact_capacitive_liquid_sensor': 'raw_value',
        'ds18b20': 'temperature',
        'dht22': 'temperature'
    };

    constructor(pinManager: PinAssignmentManager, deviceState?: DeviceState) {
        this.pinManager = pinManager;
        this.deviceState = deviceState;

        const isPkg = (process as any).pkg !== undefined;
        const rootDir = isPkg ? path.dirname(process.execPath) : path.join(_dirname, '..');

        this.scenariosFile = path.join(rootDir, 'data', 'scenarios.json');
        this.closedLoopFile = path.join(rootDir, 'data', 'closed_loop_rules.json');

        this.loadScenarios();
        this.loadClosedLoopRules();
        this.startReactiveLoop();
    }

    private loadScenarios() {
        if (!fs.existsSync(path.dirname(this.scenariosFile))) {
            fs.mkdirSync(path.dirname(this.scenariosFile), { recursive: true });
        }

        if (fs.existsSync(this.scenariosFile)) {
            try {
                const data = fs.readFileSync(this.scenariosFile, 'utf-8');
                this.scenarios = JSON.parse(data);
            } catch (e) {
                console.error('[ScenarioEngine] Failed to load scenarios:', e);
                this.scenarios = [];
            }
        }
    }

    public saveScenarios() {
        try {
            fs.writeFileSync(this.scenariosFile, JSON.stringify(this.scenarios, null, 2));
        } catch (e) {
            console.error('[ScenarioEngine] Failed to save scenarios:', e);
        }
    }

    public getScenarios(): Scenario[] {
        return this.scenarios;
    }

    public addScenario(scenario: Scenario) {
        // Replace if exists, else add
        const idx = this.scenarios.findIndex(s => s.id === scenario.id);
        if (idx >= 0) {
            this.scenarios[idx] = scenario;
        } else {
            this.scenarios.push(scenario);
        }
        this.saveScenarios();
    }

    public deleteScenario(id: string) {
        this.scenarios = this.scenarios.filter(s => s.id !== id);
        this.saveScenarios();
    }

    public startScenario(id: string) {
        const scenario = this.scenarios.find(s => s.id === id);
        if (!scenario) throw new Error(`Scenario ${id} not found`);

        this.stopScenario(); // Stop any running

        this.activeScenario = scenario;
        this.startTime = Date.now();
        console.log(`[ScenarioEngine] Starting scenario: ${scenario.name}`);

        // Lock sensors / Disable generators
        this.prepareSensors(scenario);

        // Start Loop
        this.intervalId = setInterval(() => this.tick(), 100);
    }

    public stopScenario() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
        }
        if (this.activeScenario) {
            console.log(`[ScenarioEngine] Stopping scenario: ${this.activeScenario.name}`);
            this.activeScenario = null;
        }
    }

    public getStatus() {
        return {
            running: !!this.activeScenario,
            scenarioId: this.activeScenario?.id,
            name: this.activeScenario?.name,
            elapsed: this.activeScenario ? (Date.now() - this.startTime) / 1000 : 0
        };
    }

    private prepareSensors(scenario: Scenario) {
        // Disable generators for all involved pins
        for (const step of scenario.steps) {
            const assignment = this.pinManager.getAssignment(step.pin);
            if (assignment && assignment.simConfig?.enabled) {
                console.log(`[ScenarioEngine] Disabling generator for ${step.pin} due to scenario.`);
                assignment.simConfig.enabled = false;
                this.pinManager.saveConfig(); // Persist disable
            }
        }
    }

    private interpolate(input: number, points: { raw: number; value: number }[], inputKey: 'raw' | 'value', outputKey: 'raw' | 'value'): number {
        if (points.length < 2) return input;

        // Sort by input key
        const sorted = [...points].sort((a, b) => a[inputKey] - b[inputKey]);

        // Exact match or interpolation
        for (let i = 0; i < sorted.length - 1; i++) {
            const p1 = sorted[i];
            const p2 = sorted[i + 1];

            if (input >= p1[inputKey] && input <= p2[inputKey]) {
                const range = p2[inputKey] - p1[inputKey];
                if (Math.abs(range) < 0.0001) return p1[outputKey];
                const t = (input - p1[inputKey]) / range;
                return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
            }
        }

        // Extrapolation
        if (input < sorted[0][inputKey]) {
            const p1 = sorted[0];
            const p2 = sorted[1];
            const t = (input - p1[inputKey]) / (p2[inputKey] - p1[inputKey]);
            return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
        }
        if (input > sorted[sorted.length - 1][inputKey]) {
            const p1 = sorted[sorted.length - 2];
            const p2 = sorted[sorted.length - 1];
            const t = (input - p1[inputKey]) / (p2[inputKey] - p1[inputKey]);
            return p1[outputKey] + t * (p2[outputKey] - p1[outputKey]);
        }

        return input;
    }

    private tick() {
        if (!this.activeScenario) return;

        const now = Date.now();
        const scenarioElapsed = now - this.startTime;

        for (const step of this.activeScenario.steps) {
            const startDelayMs = step.startDelay * 1000;
            const stepActiveTime = scenarioElapsed - startDelayMs;

            if (stepActiveTime < 0) {
                continue;
            }

            // Calculate current REAL Value
            const direction = step.endValue >= step.startValue ? 1 : -1;
            const stepsCount = Math.floor(stepActiveTime / step.stepInterval);
            let currentRealValue = step.startValue + (stepsCount * step.stepSize * direction);

            // Clamp Target Value
            if (direction === 1) {
                if (currentRealValue > step.endValue) currentRealValue = step.endValue;
            } else {
                if (currentRealValue < step.endValue) currentRealValue = step.endValue;
            }

            // Identify key & assignment
            let assignment = this.pinManager.getAssignment(step.pin);
            if (!assignment) continue;

            let key = step.key;
            if (!key) {
                // Try to resolve key from defined primary keys, then existing keys, then fallback
                if (assignment.sensorId && this.SENSOR_KEYS[assignment.sensorId]) {
                    key = this.SENSOR_KEYS[assignment.sensorId];
                } else {
                    const keys = Object.keys(assignment.values);
                    key = keys.length > 0 ? keys[0] : 'value';
                }
            }

            if (key) {
                // Check for Calibration: Convert Real -> Raw
                let valueToSend = currentRealValue;
                if (assignment.calibrationPoints && assignment.calibrationPoints.length >= 2) {
                    valueToSend = this.interpolate(currentRealValue, assignment.calibrationPoints, 'value', 'raw');
                }

                this.pinManager.setValue(step.pin, key, valueToSend);
            }
        }
    }

    // ==========================================
    // CLOSED-LOOP REACTIVE PHYSICS ENGINE
    // ==========================================

    private getDefaultClosedLoopRules(): ClosedLoopRule[] {
        return [
            {
                id: 'rule_soil_moisture_d2',
                name: 'Irrigation Pump (D2) -> Soil Moisture (A0)',
                enabled: true,
                actuatorPin: 'D2',
                targetPin: 'A0',
                targetKey: 'value',
                onRatePerSec: 2.0,   // +2% per second when pump is running
                offRatePerSec: 0.15, // -0.15% per second when pump is off (drying)
                minLimit: 22.0,
                maxLimit: 80.0,
                noise: 0.1
            },
            {
                id: 'rule_reservoir_refill_d3',
                name: 'Refill Valve (D3) -> Reservoir Level (A1)',
                enabled: true,
                actuatorPin: 'D3',
                targetPin: 'A1',
                targetKey: 'value',
                onRatePerSec: 3.0,
                offRatePerSec: 0.05,
                minLimit: 18.0,
                maxLimit: 90.0,
                noise: 0.1
            },
            {
                id: 'rule_climate_fan_d4',
                name: 'Exhaust Fan (D4) -> Temperature (D5/DHT)',
                enabled: true,
                actuatorPin: 'D4',
                targetPin: 'D5',
                targetKey: 'temperature',
                onRatePerSec: -0.4,
                offRatePerSec: 0.1,
                minLimit: 21.0,
                maxLimit: 29.0,
                noise: 0.05
            }
        ];
    }

    private loadClosedLoopRules() {
        if (!fs.existsSync(path.dirname(this.closedLoopFile))) {
            fs.mkdirSync(path.dirname(this.closedLoopFile), { recursive: true });
        }

        if (fs.existsSync(this.closedLoopFile)) {
            try {
                const data = fs.readFileSync(this.closedLoopFile, 'utf-8');
                this.closedLoopRules = JSON.parse(data);
                console.log(`[ScenarioEngine] Loaded ${this.closedLoopRules.length} closed-loop rules.`);
                return;
            } catch (e) {
                console.error('[ScenarioEngine] Failed to load closed-loop rules:', e);
            }
        }

        // Initialize with defaults if file doesn't exist
        this.closedLoopRules = this.getDefaultClosedLoopRules();
        this.saveClosedLoopRules();
    }

    public saveClosedLoopRules() {
        try {
            fs.writeFileSync(this.closedLoopFile, JSON.stringify(this.closedLoopRules, null, 2));
        } catch (e) {
            console.error('[ScenarioEngine] Failed to save closed-loop rules:', e);
        }
    }

    public getClosedLoopRules(): ClosedLoopRule[] {
        return this.closedLoopRules;
    }

    public setClosedLoopRule(rule: ClosedLoopRule) {
        const idx = this.closedLoopRules.findIndex(r => r.id === rule.id);
        if (idx >= 0) {
            this.closedLoopRules[idx] = rule;
        } else {
            this.closedLoopRules.push(rule);
        }
        this.saveClosedLoopRules();
    }

    public deleteClosedLoopRule(id: string) {
        this.closedLoopRules = this.closedLoopRules.filter(r => r.id !== id);
        this.saveClosedLoopRules();
    }

    public startReactiveLoop() {
        if (this.reactiveIntervalId) return;
        this.lastReactiveTick = Date.now();
        this.reactiveIntervalId = setInterval(() => this.reactiveTick(), 500);
        console.log('[ScenarioEngine] Closed-Loop Reactive Physics Engine running (500ms cycle).');
    }

    public stopReactiveLoop() {
        if (this.reactiveIntervalId) {
            clearInterval(this.reactiveIntervalId);
            this.reactiveIntervalId = null;
            console.log('[ScenarioEngine] Closed-Loop Reactive Physics Engine stopped.');
        }
    }

    public isReactiveLoopRunning(): boolean {
        return this.reactiveIntervalId !== null;
    }

    public getActuatorState(actuatorPin: string): boolean {
        const pinStr = String(actuatorPin).trim();

        // 1. Check DeviceState if available
        if (this.deviceState) {
            if (this.deviceState.getRelayState(pinStr) === 1) return true;
            if (pinStr.startsWith('D') && this.deviceState.getRelayState(pinStr.substring(1)) === 1) return true;
            if (!pinStr.startsWith('D') && this.deviceState.getRelayState(`D${pinStr}`) === 1) return true;
        }

        // 2. Check PinAssignmentManager assignment values
        const assignment = this.pinManager.getAssignment(pinStr);
        if (assignment && assignment.values) {
            if (assignment.values['state'] === 1 || assignment.values['value'] === 1) return true;
        }

        return false;
    }

    private reactiveTick() {
        if (this.closedLoopRules.length === 0) return;

        const now = Date.now();
        const dt = Math.max(0.1, (now - this.lastReactiveTick) / 1000);
        this.lastReactiveTick = now;

        for (const rule of this.closedLoopRules) {
            if (!rule.enabled) continue;

            const targetAssignment = this.pinManager.getAssignment(rule.targetPin);
            if (!targetAssignment) continue;

            let key = rule.targetKey;
            if (!key) {
                if (targetAssignment.sensorId && this.SENSOR_KEYS[targetAssignment.sensorId]) {
                    key = this.SENSOR_KEYS[targetAssignment.sensorId];
                } else {
                    const keys = Object.keys(targetAssignment.values);
                    key = keys.length > 0 ? keys[0] : 'value';
                }
            }

            let currentVal = targetAssignment.values[key];
            if (currentVal === undefined || isNaN(currentVal)) {
                currentVal = rule.minLimit;
            }

            const isActuatorOn = this.getActuatorState(rule.actuatorPin);

            let nextVal = currentVal;
            if (isActuatorOn) {
                // Moving towards maxLimit with onRatePerSec
                nextVal = currentVal + (rule.onRatePerSec * dt);
            } else {
                // Moving towards minLimit with offRatePerSec
                nextVal = currentVal - (rule.offRatePerSec * dt);
            }

            // Clamp between minLimit and maxLimit
            const lower = Math.min(rule.minLimit, rule.maxLimit);
            const upper = Math.max(rule.minLimit, rule.maxLimit);
            nextVal = Math.max(lower, Math.min(upper, nextVal));

            // Optional subtle noise for natural sensor jitter
            if (rule.noise && rule.noise > 0) {
                const jitter = (Math.random() - 0.5) * 2 * rule.noise;
                nextVal = Math.max(lower, Math.min(upper, nextVal + jitter));
            }

            // Round to 1 decimal place
            nextVal = Math.round(nextVal * 10) / 10;

            if (Math.abs(nextVal - currentVal) > 0.001) {
                // Update in memory without synchronous disk writes to protect flash/SD
                this.pinManager.setValue(rule.targetPin, key, nextVal, false);

                // If updating raw_value, also sync display value slider (0-100%)
                if (key === 'raw_value' && 'value' in targetAssignment.values) {
                    const scaledVal = Math.round((nextVal / 10.23) * 10) / 10;
                    this.pinManager.setValue(rule.targetPin, 'value', scaledVal, false);
                }
            }
        }
    }
}
