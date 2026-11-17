/**
 * UdpProtocolHandler v2 - Pin-based sensor resolution
 * 
 * Now uses PinAssignmentManager to determine:
 * - What sensor is assigned to which pin
 * - What values to return based on sensor type
 */

import { DeviceState } from './DeviceState.js';
import { PinAssignmentManager } from './PinAssignmentManager.js';
import { SensorRegistry } from './SensorRegistry.js';

interface ControllerInfo {
    mac: string;
    model: string;
    firmwareVersion: string;
}

export class ProtocolHandler {
    private deviceState: DeviceState;
    private pinManager: PinAssignmentManager;
    private sensorRegistry: SensorRegistry;
    private info: ControllerInfo;
    private capabilities: string[] = [
        'ANALOG', 'DIGITAL_READ', 'DIGITAL_WRITE', 'RELAY_SET',
        'PWM_WRITE', 'SERVO_WRITE', 'DHT_READ', 'ONEWIRE_READ_TEMP',
        'ULTRASONIC_TRIG_ECHO', 'I2C_TRANSFER', 'I2C_SEQUENCE', 'UART_TRANSFER', 'MODBUS_RTU',
        'PULSE_COUNT', 'HX711_READ'
    ];
    private ttlTimers = new Map<string, NodeJS.Timeout>();

    constructor(
        deviceState: DeviceState,
        pinManager: PinAssignmentManager,
        sensorRegistry: SensorRegistry,
        info: ControllerInfo
    ) {
        this.deviceState = deviceState;
        this.pinManager = pinManager;
        this.sensorRegistry = sensorRegistry;
        this.info = info;
    }

    /**
     * Main command handler
     */
    handleCommand(rawCommand: string): object | string | null {
        const command = rawCommand.trim();
        if (command !== 'PING' && command !== 'STATUS') {
            console.log(`[PROTO] RX: ${command}`);
        }

        // Error injection checks
        if (this.deviceState.getIsOffline()) {
            console.log('[PROTO] Simulating offline - no response');
            return null;
        }

        let cmd: string;
        let params: any[] = []; // Changed to any[] to support non-string args from JSON
        let reqId: any = undefined; // Transaction ID

        // === DUAL PROTOCOL SUPPORT ===
        if (command.startsWith('{')) {
            // Try parsing as Unified JSON Protocol
            try {
                const jsonObj = JSON.parse(command);
                cmd = jsonObj.cmd || jsonObj.c; // Support long 'cmd' or short 'c'
                reqId = jsonObj.id;

                // Extract params/args
                if (Array.isArray(jsonObj.args)) {
                    params = jsonObj.args;
                } else if (Array.isArray(jsonObj.p)) {
                    params = jsonObj.p;
                } else if (jsonObj.params) {
                    // Legacy/Modbus might send params object or array
                    params = Array.isArray(jsonObj.params) ? jsonObj.params : [JSON.stringify(jsonObj.params)];
                } else {
                    // Use case: MODBUS_RTU sends top-level params (slaveId, etc.)
                    if (cmd === 'MODBUS_RTU') {
                        // Pass the whole object as the first param string,
                        // because handleModbusRtu parses params[0] as JSON
                        params = [JSON.stringify(jsonObj)];
                    }
                }

                if (cmd === 'MODBUS_RTU' || cmd === 'I2C_TRANSFER' || cmd === 'I2C_SEQUENCE' || cmd === 'UART_TRANSFER') {
                    // Pass the whole object directly
                    params = [jsonObj];
                }

                console.log(`[PROTO] JSON Command: ${cmd}, ID: ${reqId}, Args:`, params);

            } catch (e) {
                console.error('[PROTO] JSON Parse Error:', e);
                return { ok: 0, error: 'ERR_INVALID_JSON' };
            }
        } else {
            // Legacy Pipe Protocol
            const parts = command.split('|');
            cmd = parts[0];
            params = parts.slice(1);
        }

        if (!cmd) return { ok: 0, error: 'ERR_MISSING_CMD' };

        if (this.deviceState.isCommandBlocked(cmd)) {
            console.log(`[PROTO] Command ${cmd} blocked - simulating timeout`);
            return null;
        }

        if (this.deviceState.shouldReturnInvalid(cmd)) {
            console.log(`[PROTO] Command ${cmd} - simulating invalid response`);
            return 'INVALID_RESPONSE{{{broken_json';
        }

        try {
            const result = this.routeCommand(cmd, params) as any;
            if (reqId !== undefined && typeof result === 'object') {
                result.id = reqId;
            }
            return result;
        } catch (e: any) {
            return { ok: 0, error: e.message, id: reqId };
        }
    }

    private routeCommand(cmd: string, params: any[]): object {
        switch (cmd) {
            // ... (System Commands kept same) ...
            // ============ System Commands ============
            case 'PING':
                return { ok: 1, pong: 1 };

            case 'STATUS':
                return {
                    ok: 1,
                    status: 'running',
                    up: this.deviceState.getUptime()
                };

            case 'INFO':
                return {
                    ok: 1,
                    up: this.deviceState.getUptime(),
                    mem: 32768,
                    ver: this.info.firmwareVersion,
                    mac: this.info.mac,
                    ip: '127.0.0.1',
                    capabilities: this.capabilities
                };

            case 'RESET':
                console.log('[PROTO] Reset command received');
                return { ok: 1, msg: 'Resetting...' };

            case 'HYDROPONICS_DISCOVERY':
                return {
                    type: 'ANNOUNCE',
                    mac: this.info.mac,
                    ip: '127.0.0.1',
                    model: this.info.model,
                    firmware: this.info.firmwareVersion,
                    capabilities: this.capabilities
                };

            // ============ Sensor Commands (Pin-Based) ============
            case 'ANALOG':
                return this.handlePinBasedCommand(cmd, params, 'value');

            case 'DIGITAL_READ':
                return this.handleDigitalRead(params);

            case 'DHT_READ':
                return this.handleDhtRead(params);

            case 'ONEWIRE_READ_TEMP':
                return this.handlePinBasedCommand(cmd, params, 'value');

            case 'ULTRASONIC_TRIG_ECHO':
                return this.handleMultiPinCommand(cmd, params);

            case 'UART_TRANSFER':
                return this.handleUartTransfer(params);

            case 'I2C_TRANSFER':
                return this.handleI2cTransfer(params);

            case 'I2C_SEQUENCE':
                return this.handleI2cSequence(params);

            case 'MODBUS_RTU':
                return this.handleModbusRtu(params);

            case 'PULSE_COUNT':
                return this.handlePulseCount(params);

            case 'HX711_READ':
                return this.handleHx711Read(params);

            // ============ Actuator Handlers ============

            case 'DIGITAL_WRITE':
                return this.handleDigitalWrite(params);

            case 'RELAY_SET':
                // Reuse logic
                return this.handleDigitalWrite(params);

            case 'PWM_WRITE':
                return this.handlePwmWrite(params);

            case 'SERVO_WRITE':
                return this.handleServoWrite(params);

            default:
                return { ok: 0, error: 'ERR_INVALID_COMMAND' };
        }
    }

    // ... (Sensor Handlers kept same) ...

    // ============ Pin-Based Sensor Handlers ============

    /**
     * Handle single-pin commands (ANALOG, ONEWIRE_READ_TEMP)
     */
    private handlePinBasedCommand(cmd: string, params: any[], defaultKey: string): object {
        if (params.length < 1) {
            return { ok: 0, error: 'ERR_MISSING_PIN' };
        }

        const pin = params[0];
        const assignment = this.pinManager.getAssignment(pin);

        if (!assignment) {
            console.log(`[PROTO] No sensor assigned to ${pin}, returning error`);
            return { ok: 0, error: 'ERR_NO_SENSOR_ASSIGNED' };
        }

        const values = this.pinManager.getValues(String(pin)) || {};
        const firstValueKey = Object.keys(values)[0];
        const rawValue = values[firstValueKey] ?? 0;

        console.log(`[PROTO] Pin ${pin} (${assignment.sensorId}) → {"ok":1,"value":${rawValue}}`);
        return { ok: 1, value: rawValue };
    }

    private handleMultiPinCommand(cmd: string, params: any[]): object {
        if (params.length < 2) {
            return { ok: 0, error: 'ERR_MISSING_PINS' };
        }

        const primaryPin = params[0];
        const assignment = this.pinManager.getAssignment(primaryPin);

        if (!assignment) {
            console.log(`[PROTO] No sensor assigned to ${primaryPin}, returning error`);
            return { ok: 0, error: 'ERR_NO_SENSOR_ASSIGNED' };
        }

        const values = this.pinManager.getValues(String(primaryPin)) || {};
        const val = values['value'] ?? values['distance'] ?? 100;

        console.log(`[PROTO] Multi-pin ${primaryPin} (${assignment.sensorId}) → value: ${val}`);
        return { ok: 1, value: val };
    }

    private handleDhtRead(params: any[]): object {
        if (params.length < 1) {
            return { ok: 0, error: 'ERR_MISSING_PIN' };
        }

        const pin = String(params[0]);
        const assignment = this.pinManager.getAssignment(pin);

        if (!assignment) {
            return { ok: 1, temp: 25.0, humidity: 50.0 };
        }

        const values = this.pinManager.getValues(pin) || {};
        return {
            ok: 1,
            temp: values['temp'] ?? 25.0,
            humidity: values['humidity'] ?? 50.0
        };
    }

    private handleDigitalRead(params: any[]): object {
        if (params.length < 1) {
            return { ok: 0, error: 'ERR_MISSING_PIN' };
        }
        const pin = String(params[0]);
        const value = this.deviceState.getRelayState(pin);
        return { ok: 1, pin, value };
    }

    /**
     * I2C_TRANSFER: universal I2C — returns raw byte array.
     * Backend decodes bytes via responseProcessing in template.
     * params: JSON object with address, write[], readLen, delayMs
     */
    private handleI2cTransfer(params: any[]): object {
        let address: number = 0;
        let readLen: number = 0;
        let writeData: any = null;

        if (params.length >= 1) {
            try {
                const json = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
                address = parseInt(json.addr ?? json.address ?? 0);
                readLen = parseInt(json.len ?? json.readLen ?? 0);
                writeData = json.write;
            } catch {
                address = 0;
            }
        }

        if (address === 0) return { ok: 0, error: 'ERR_INVALID_ADDRESS' };

        const addrHex = `0x${address.toString(16).toUpperCase()}`;
        const registers: number[] = new Array(readLen).fill(0);
        let foundAny = false;

        const allAssignments = this.pinManager.getAllAssignments();
        console.log(`[DEBUG] I2C Request: addr=${addrHex}, len=${readLen}, write=${JSON.stringify(writeData)}`);

        for (const assignment of allAssignments) {
            let matched = false;

            // Interface compatibility check
            const hwInterface = assignment.hardwareCmd?.toUpperCase();
            if (hwInterface !== 'I2C_TRANSFER' && hwInterface !== 'I2C' && hwInterface !== 'I2C_SEQUENCE') {
                continue;
            }

            if (assignment.addr !== undefined) {
                const asgnAddrNum = typeof assignment.addr === 'string' ? parseInt(assignment.addr) : assignment.addr;
                if (asgnAddrNum === address) matched = true;
            } else {
                const template = this.sensorRegistry.getSensor(assignment.sensorId);
                const tmplAddr = template?.commands?.READ?.params?.addr ?? template?.commands?.READ?.params?.address;
                if (tmplAddr !== undefined) {
                    const tmplAddrNum = typeof tmplAddr === 'string' ? parseInt(tmplAddr) : tmplAddr;
                    if (tmplAddrNum === address) matched = true;
                }
            }

            if (!matched) continue;
            foundAny = true;
            console.log(`[DEBUG] Matched sensor: ${assignment.sensorId}`);

            if (readLen <= 0) continue;

            const template = this.sensorRegistry.getSensor(assignment.sensorId);
            const readCmd = template?.commands?.READ;
            const rp = readCmd?.responseProcessing;

            let writeVal = -1;
            if (writeData !== null) {
                writeVal = Array.isArray(writeData) ? (writeData[0] ?? 0) : (typeof writeData === 'number' ? writeData : 0);
            }

            // --- Multi-Channel Aggregation (Mother Mode) ---
            const multiValues = assignment.multiValues || {};
            const labels = assignment.indexLabels || {};
            const hasMulti = Object.keys(multiValues).length > 0;

            if (hasMulti) {
                Object.entries(multiValues).forEach(([idx, val]) => {
                    const label = (labels[Number(idx)] || '').trim();
                    const dataMatch = label.match(/(data|i2c)\s*\[\s*(\d+)\s*\]/i);
                    const regMatch = label.match(/reg\s*\[\s*(\d+)\s*\]/i);

                    let targetOffset = -1;
                    if (dataMatch) {
                        targetOffset = parseInt(dataMatch[2]);
                    } else if (regMatch && writeVal !== -1) {
                        if (parseInt(regMatch[1]) === writeVal) targetOffset = rp?.offset ?? 0;
                    } else if (writeVal === -1 || writeVal === 0) {
                        // Fallback: If it's the first channel and no specific register, use template offset
                        if (Number(idx) === 0) targetOffset = rp?.offset ?? 0;
                    }

                    if (targetOffset !== -1 && (targetOffset < readLen)) {
                        const divisor = rp?.divisor ?? 1.0;
                        const length = rp?.length ?? 2;
                        const endian = rp?.endian ?? 'big';
                        let intVal = Math.round(Number(val) * divisor);

                        for (let i = 0; i < length && (targetOffset + i) < readLen; i++) {
                            const byteVal = (endian === 'big') ? (intVal >> (8 * (length - 1 - i))) & 0xFF : (intVal >> (8 * i)) & 0xFF;
                            registers[targetOffset + i] = byteVal;
                        }
                        console.log(`[PROTO] I2C_TRANSFER AGGREGATE [${assignment.sensorId}] ch=${idx} (${label}) val=${val} → registers[${targetOffset}]=${registers[targetOffset]}`);
                    } else {
                        console.log(`[DEBUG] ch=${idx} (${label}) skip: offset=${targetOffset}, len=${readLen}`);
                    }
                });
            }

            // --- Single-Value / Primary Encoding ---
            if (!hasMulti || (Object.values(labels).length === 0)) {
                if (rp && (rp.type === 'bytes' || rp.type === 'bytes_with_checksum' || rp.type === 'bytes_le')) {
                    const val = Number(Object.values(assignment.values)[0] ?? 0);
                    const divisor = rp.divisor || 1.0;
                    const length = rp.length || 2;
                    const endian = rp.endian || 'big';
                    const offset = rp.offset ?? 0;

                    let intVal = Math.round(val * divisor);
                    for (let i = 0; i < length && (offset + i) < readLen; i++) {
                        const byteVal = (endian === 'big') ? (intVal >> (8 * (length - 1 - i))) & 0xFF : (intVal >> (8 * i)) & 0xFF;
                        registers[offset + i] = byteVal;
                    }
                    console.log(`[PROTO] I2C_TRANSFER ENCODE [${assignment.sensorId}] val=${val} → registers[${offset}...]=${JSON.stringify(registers.slice(offset, offset + length))}`);
                }
            }
        }

        if (!foundAny && readLen > 0) {
            console.log(`[PROTO] I2C_TRANSFER ERROR at ${addrHex} — No device assigned`);
            return { ok: 0, error: 'ERR_I2C_TIMEOUT', addr: addrHex };
        }

        console.log(`[DEBUG] Final registers: ${JSON.stringify(registers)}`);
        return { ok: 1, addr: addrHex, data: registers };
    }

    /**
     * I2C_SEQUENCE: universal I2C atomic operations (write, delay, read)
     * We map this directly to handleI2cTransfer to utilize existing I2C simulation logic.
     */
    private handleI2cSequence(params: any[]): object {
        const json = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
        const address = parseInt(json.addr ?? json.address ?? 0);
        
        let totalReadLen = 0;
        if (Array.isArray(json.steps)) {
            for (const step of json.steps) {
                if (step.op === 'read' && step.len) {
                    totalReadLen += parseInt(step.len);
                }
            }
        }
        
        // Pass to the existing I2C simulator logic
        console.log(`[PROTO] I2C_SEQUENCE addr=${address} calculated readLen=${totalReadLen}`);
        const mockI2cParams = [{ addr: address, len: totalReadLen }];
        return this.handleI2cTransfer(mockI2cParams);
    }

    /**
     * UART_TRANSFER: universal UART — returns raw bytes OR ASCII string.
     * Simulator returns response based on readLen and valuePath in template.
     */
    private handleUartTransfer(params: any[]): object {
        const json = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
        const rx = json.rx ?? json.rxPin;
        const tx = json.tx ?? json.txPin;
        const readLen = parseInt(json.readLen || 0);
        const terminator = json.terminator !== undefined ? Number(json.terminator) : null;

        const assignment = this.pinManager.getBusAssignment([rx, tx]);

        if (!assignment) {
            // Strict mode: No assignment found on these pins — return timeout
            console.log(`[PROTO] UART_TRANSFER ERROR [${rx}/${tx}] — No device assigned`);
            return { ok: 0, error: 'ERR_UART_TIMEOUT' };
        }

        const values = this.pinManager.getValues(assignment.id) || {};
        const sensor = this.sensorRegistry.getSensor(assignment.sensorId);
        const readCmd = sensor?.commands?.['READ'];

        // Combine valuePath from command or roles
        let valuePath = readCmd?.valuePath || 'value';
        const rp = readCmd?.responseProcessing;

        // Simulator return data buffer
        const data = new Array(readLen > 0 ? readLen : 8).fill(0);

        // Apply terminator if specified
        if (terminator !== null && readLen > 0) {
            data[readLen - 1] = terminator;
        }

        // Handle ASCII sensors (e.g. Atlas)
        if (rp?.type === 'ascii_float') {
            const val = Number(Object.values(values)[0] ?? 0);
            console.log(`[PROTO] UART_TRANSFER [${assignment.sensorId}] → ASCII: ${val.toFixed(2)}`);
            return { ok: 1, str: val.toFixed(2) };
        }

        // Handle sliding window ultrasonic (A02YYUW)
        if (rp?.type === 'a02yyuw_sliding') {
            const val = Number(Object.values(values)[0] ?? 0); // distance in mm
            const intVal = Math.round(val);
            const data_H = (intVal >> 8) & 0xFF;
            const data_L = intVal & 0xFF;
            const sum = (0xFF + data_H + data_L) & 0xFF;

            if (data.length >= 4) {
                data[0] = 0xFF;
                data[1] = data_H;
                data[2] = data_L;
                data[3] = sum;
            }
            console.log(`[PROTO] UART_TRANSFER [${assignment.sensorId}] → A02YYUW: ${intVal}mm`);
            return { ok: 1, data };
        }

        // Determine offset from valuePath (e.g. "data[25]")
        let offset = rp?.offset ?? 0;
        const dataMatch = valuePath.match(/data\[(\d+)\]/);
        if (dataMatch) {
            offset = parseInt(dataMatch[1]);
        }

        // Multi-Channel logic: If we have multiple values, check their labels for data[X] mapping
        const multiValues = assignment.multiValues || {};
        const labels = assignment.indexLabels || {};
        const hasMulti = Object.keys(multiValues).length > 0;

        if (hasMulti) {
            Object.entries(multiValues).forEach(([idx, val]) => {
                const label = labels[Number(idx)] || '';
                const match = label.match(/data\[(\d+)\]/);
                if (match) {
                    const targetOffset = parseInt(match[1]);
                    const divisor = rp?.divisor ?? 1; // Use default or specific divisor
                    const intVal = Math.round(Number(val) / divisor);
                    const byteLen = 2; // Default to 2 bytes for Modbus-style responses
                    const endian = 'big';

                    if (targetOffset + byteLen <= data.length) {
                        for (let i = 0; i < byteLen; i++) {
                            const shift = (byteLen - 1 - i) * 8;
                            data[targetOffset + i] = (intVal >> shift) & 0xFF;
                        }
                    }
                }
            });
        }

        // Single-value fallback (primary logic)
        if (!hasMulti || !Object.values(labels).some(l => l.includes('data['))) {
            const primaryVal = Number(Object.values(values)[0] ?? 0);
            const divisor = rp?.divisor ?? 1;
            const intVal = Math.round(primaryVal / divisor);
            const byteLen = rp?.length ?? 2;
            const endian = rp?.endian || 'big';

            if (offset + byteLen <= data.length) {
                for (let i = 0; i < byteLen; i++) {
                    const shift = endian === 'big' ? (byteLen - 1 - i) * 8 : i * 8;
                    data[offset + i] = (intVal >> shift) & 0xFF;
                }
            }
        }

        console.log(`[PROTO] UART_TRANSFER [${assignment.sensorId}] → readLen=${readLen} offset=${offset} data:`, data);
        return { ok: 1, data };
    }

    /**
     * MODBUS_RTU: replaces MODBUS_RTU_READ. Same logic, supports baudRate param.
     */
    private handleModbusRtu(params: any[]): object {
        if (params.length < 1) {
            return { ok: 0, error: 'ERR_MISSING_PARAMS' };
        }
        try {
            const jsonParams = typeof params[0] === 'string' ? JSON.parse(params[0]) : params[0];
            const len = jsonParams.len || 1;
            let txPin = jsonParams.txPin;
            let rxPin = jsonParams.rxPin;

            if (jsonParams.pins && Array.isArray(jsonParams.pins)) {
                for (const p of jsonParams.pins) {
                    if (p.role === 'TX') txPin = p.gpio;
                    else if (p.role === 'RX') rxPin = p.gpio;
                }
            } else if (jsonParams.args && Array.isArray(jsonParams.args) && jsonParams.args.length >= 2) {
                rxPin = jsonParams.args[0];
                txPin = jsonParams.args[1];
            }

            const slaveId = jsonParams.slaveId;

            // Pattern Matching: Find assignments for these pins
            const allAssignments = this.pinManager.getAllAssignments();
            let assignment = null;

            for (const asgn of allAssignments) {
                // If Pins match...
                if (asgn.pins.includes(String(txPin)) || asgn.pins.includes(String(rxPin))) {
                    // And IF we have a slaveId in payload, it MUST match
                    if (slaveId !== undefined) {
                        if (asgn.slaveId === slaveId) {
                            assignment = asgn;
                            break;
                        }
                    } else {
                        // Just take the first one if no slaveId provided
                        assignment = asgn;
                        break;
                    }
                }
            }

            const registers: number[] = [];
            const startReg = jsonParams.reg ?? jsonParams.addr ?? jsonParams.address ?? 0;

            if (assignment) {
                if (assignment.multiValues) {
                    // Populate from multi-channel values (Mother mode) starting from startReg
                    for (let i = 0; i < len; i++) {
                        const val = assignment.multiValues[startReg + i] ?? 0;
                        registers.push(Math.round(val));
                    }
                    console.log(`[PROTO] MODBUS_RTU (Pin ${txPin}/${rxPin}) -> Reg ${startReg}, Len ${len}, Multi: [${registers.join(', ')}]`);
                } else {
                    // Legacy/Single value mode: Repeat first available value
                    const val = Number(Object.values(assignment.values)[0] ?? 0);
                    for (let i = 0; i < len; i++) {
                        registers.push(Math.round(val));
                    }
                    console.log(`[PROTO] MODBUS_RTU (Pin ${txPin}/${rxPin}) -> Single: ${val}`);
                }
            } else {
                console.warn(`[PROTO] MODBUS_RTU TIMEOUT: No sensor on Pin ${txPin}/${rxPin}`);
                return { ok: 0, error: 'TIMEOUT' };
            }

            return { ok: 1, value: registers[0], registers };
        } catch (e) {
            console.error('[PROTO] MODBUS_RTU Error:', e);
            return { ok: 0, error: 'ERR_INVALID_JSON' };
        }
    }

    /**
     * PULSE_COUNT: counts pulses for durationMs.
     * Returns count — backend converts to L/min or Hz via calibration.
     */
    private handlePulseCount(params: any[]): object {
        const pin = String(params[0] ?? '');
        const durationMs = params[1] ? parseInt(params[1]) : 1000;
        const assignment = this.pinManager.getAssignment(pin);

        let count = 45; // default simulated pulse count
        if (assignment) {
            const values = assignment.values || {};
            // Simulate: if flow_rate = 7.5 L/min, Hz = 7.5 * 7.5 = 56 Hz, count = 56
            const rate = Number(Object.values(values)[0] ?? 7.5);
            count = Math.round(rate * 7.5 * (durationMs / 1000));
        }

        console.log(`[PROTO] PULSE_COUNT pin=${pin} dur=${durationMs}ms → value=${count}`);
        return { ok: 1, value: count, durationMs };
    }

    /**
     * HX711_READ: returns raw 24-bit ADC value from load cell.
     * Backend converts to grams via multi_point calibration.
     */
    private handleHx711Read(params: any[]): object {
        const dtPin = String(params[0] ?? '');
        const assignment = this.pinManager.getAssignment(dtPin);

        let rawValue = 0;
        if (assignment) {
            const values = assignment.values || {};
            const grams = Number(Object.values(values)[0] ?? 0);
            // Simulate: 100g ≈ 50000 raw units (typical calibration)
            rawValue = Math.round(grams * 500);
        }

        console.log(`[PROTO] HX711_READ pin=${dtPin} → value=${rawValue}`);
        return { ok: 1, value: rawValue };
    }

    // ============ Actuator Handlers ============

    private handleDigitalWrite(params: any[]): object {
        if (params.length < 2) {
            return { ok: 0, error: 'ERR_MISSING_PARAMS' };
        }
        const pin = String(params[0]);
        const state = parseInt(params[1]) as 0 | 1;
        const ttl = params[2] ? parseInt(params[2]) : 0;

        this.deviceState.setRelayState(pin, state);

        // Sync with PinAssignmentManager (Actuators)
        const assignment = this.pinManager.getAssignment(String(pin));
        if (assignment) {
            this.pinManager.setValue(String(pin), 'state', state);
            if (state === 0) {
                this.pinManager.setValue(String(pin), 'pwm_speed', 0);
            }
        }

        // TTL Logic
        if (this.ttlTimers.has(pin)) {
            clearTimeout(this.ttlTimers.get(pin)!);
            this.ttlTimers.delete(pin);
        }

        if (ttl > 0) {
            // Firmware safety behavior: always revert to LOW (0) upon TTL expiration
            const timer = setTimeout(() => {
                const currentState = this.deviceState.getRelayState(pin);
                this.deviceState.setRelayState(pin, 0);
                this.ttlTimers.delete(pin);
                console.log(`[TTL] Expired: Hardware reverted pin ${pin} to 0 (LOW)`);
            }, ttl); // TTL is now expected in milliseconds from Backend

            this.ttlTimers.set(pin, timer);
            return { ok: 1, ttl };
        }

        return { ok: 1 };
    }

    private handleRelaySet(params: any[]): object {
        return this.handleDigitalWrite(params);
    }

    private handlePwmWrite(params: any[]): object {
        if (params.length < 2) {
            return { ok: 0, error: 'ERR_MISSING_PARAMS' };
        }
        const pin = String(params[0]);
        const value = parseInt(params[1]);
        
        const assignment = this.pinManager.getAssignment(pin);
        if (assignment) {
            this.pinManager.setValue(pin, 'pwm_speed', value);
        }
        
        console.log(`[PWM] Pin ${pin} set to ${value}`);
        return { ok: 1 };
    }

    private handleServoWrite(params: any[]): object {
        if (params.length < 2) {
            return { ok: 0, error: 'ERR_MISSING_PARAMS' };
        }
        const pin = params[0];
        const angle = parseInt(params[1]);
        console.log(`[SERVO] Pin ${pin} set to ${angle}°`);
        return { ok: 1 };
    }
}
