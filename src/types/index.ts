export interface ControllerInfo {
    key: string;
    label?: string;
    pins: PinDefinition[];
    adcMax: number;
}

export interface PinDefinition {
    id: string;      // e.g. "A0"
    label?: string;  // e.g. "Analog Pin 0"
    pin?: number;    // GPIO number (e.g. 14)
    type: string | string[];
    adc?: number;
    pwm?: boolean;
    interface?: string; // e.g. "i2c"
    mappedPins?: string[]; // For virtual buses: e.g. ["A4", "A5"]
}

export interface PinAssignment {
    sensorId: string;
    pins: string[];
    values: Record<string, number>;
    hardwareCmd: string;
    limits?: { min: number; max: number };
    perKeyLimits?: Record<string, { min?: number; max?: number }>;
    calibrationPoints?: { raw: number; value: number }[];
    multiCalibration?: Record<number, { raw: number; value: number }[]>;
    multiValues?: Record<number, number>;
    indexLabels?: Record<number, string>;
    simConfig?: { enabled: boolean; mode: string; min: number; max: number };
    assigned?: boolean;
    sensorName?: string;
    sensorCategory?: string;
    isParentTemplate?: boolean;
    parentTag?: string;
    orderIndex?: number;
    userLabel?: string;
    units?: Record<string, string>;
    rawUnit?: string;
}

export interface SensorDefinition {
    id: string;
    name: string;
    category: 'SENSOR' | 'ACTUATOR';
    pinCount: number;
    pins: { name: string; type: string }[];
    parentTag?: string;
}

export interface SimulatorState {
    controller: string;
    assignments: PinAssignment[];
    uptime: number;
    isOffline: boolean;
}
