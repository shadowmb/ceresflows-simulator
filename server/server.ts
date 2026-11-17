/**
 * Hydroponics Hardware Simulator v2
 * 
 * Now with:
 * - Dynamic controller/sensor templates from backend config
 * - Pin-based sensor assignment
 * - Template-accurate response formats
 */

import dgram from 'dgram';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

import { DeviceState } from './DeviceState.js';
import { ProtocolHandler } from './ProtocolHandler.js';
import { MqttHandler } from './MqttHandler.js';
import { ScenarioEngine } from './ScenarioEngine.js';
import { ControllerRegistry } from './ControllerRegistry.js';
import { SensorRegistry } from './SensorRegistry.js';
import { PinAssignmentManager } from './PinAssignmentManager.js';

// ESM Shim
// ESM Shim (Hybrid for CJS bundle & ESM Dev)
const _filename = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const _dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(_filename);

// Configuration
const UDP_PORT = parseInt(process.env.UDP_PORT || '8888');
let httpPort = parseInt(process.env.HTTP_PORT || '3001');
const CONTROLLER_MAC = process.env.MAC || 'SIM:00:00:00:00:01';
const CONTROLLER_MODEL = process.env.MODEL || 'Simulator-ESP32';

// Initialize registries
const controllerRegistry = new ControllerRegistry();
const sensorRegistry = new SensorRegistry();

import { ProfileManager, SimulatorProfile } from './ProfileManager.js';

// ... (existing imports)

// Initialize state management
const deviceState = new DeviceState();
const pinManager = new PinAssignmentManager(sensorRegistry);
const profileManager = new ProfileManager();

// Protocol handler with pin awareness
// Mutable configuration for dynamic updates
const controllerConfig: SimulatorProfile = {
    id: 'default',
    name: 'Default Simulator',
    mac: process.env.MAC || 'SIM:00:00:00:00:01',
    controllerType: process.env.MODEL || 'Arduino_Uno_R4_WiFi',
    udpPort: parseInt(process.env.UDP_PORT || '8888'),
    created: new Date().toISOString(),
    lastUsed: new Date().toISOString()
};

const protocolHandler = new ProtocolHandler(
    deviceState,
    pinManager,
    sensorRegistry,
    // Proxy object to map Profile to ControllerInfo
    {
        get mac() { return controllerConfig.mac; },
        get model() { return controllerConfig.controllerType; },
        firmwareVersion: '1.0-v5-sim-profiled'
    }
);

const mqttHandler = new MqttHandler(protocolHandler, controllerConfig.mac);
mqttHandler.setLogCallback(broadcastToSSE);

const scenarioEngine = new ScenarioEngine(pinManager, deviceState);

// Active controller selection
let activeController = 'Arduino_Uno_R4_WiFi'; // Will be set in setup

// SSE clients for real-time UDP log
const sseClients: Set<any> = new Set();

// ============ UDP Server ============

let udpServer: dgram.Socket | null = null;

// Helper to broadcast to all SSE clients
function broadcastToSSE(data: any) {
    const message = `data: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(message);
        } catch (e) {
            sseClients.delete(client);
        }
    }
}

function startUdpServer(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
        const socket = dgram.createSocket('udp4');
        let bound = false;

        const errorHandler = (err: any) => {
            if (!bound) {
                socket.close();
                reject(err);
            } else {
                console.error(`[UDP] Server error:\n${err.stack}`);
                socket.close();
            }
        };

        socket.on('error', errorHandler);

        socket.on('message', (msg, rinfo) => {
            const command = msg.toString().trim();
            const timestamp = new Date().toISOString();
            console.log(`[UDP] ← ${rinfo.address}:${rinfo.port} | ${command}`);

            broadcastToSSE({
                type: 'incoming',
                from: `${rinfo.address}:${rinfo.port}`,
                command,
                timestamp
            });

            const response = protocolHandler.handleCommand(command);

            if (response !== null) {
                const responseStr = typeof response === 'string' ? response : JSON.stringify(response);
                console.log(`[UDP] → ${responseStr}`);

                broadcastToSSE({
                    type: 'outgoing',
                    response: responseStr,
                    timestamp
                });

                socket.send(responseStr, rinfo.port, rinfo.address, (err) => {
                    if (err) console.error('[UDP] Send error:', err);
                });
            }
        });

        socket.bind(port, () => {
            bound = true;
            const address = socket.address();
            console.log(`[UDP] Simulator listening on ${address.address}:${address.port}`);
            udpServer = socket;
            resolve();
        });
    });
}

// udpServer.bind() moved to setup

// ============ HTTP Server (UI + API) ============

const app = express();
app.use(express.json());
app.use(express.static(path.join(_dirname, '../public')));

// ---------- SSE Endpoint for UDP Log ----------

app.get('/api/udp-log', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // Send initial connection message
    res.write(`data: ${JSON.stringify({ type: 'connected', message: 'UDP Log stream connected' })}\n\n`);

    // Add client to SSE set
    sseClients.add(res);
    console.log(`[SSE] Client connected. Total: ${sseClients.size}`);

    // Remove client on disconnect
    req.on('close', () => {
        sseClients.delete(res);
        console.log(`[SSE] Client disconnected. Total: ${sseClients.size}`);
    });
});

// ---------- MQTT API ----------

app.post('/api/mqtt/connect', (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ success: false, error: 'URL required' });

    mqttHandler.connect(url);
    res.json({ success: true, message: 'Connecting to MQTT...' });
});

app.post('/api/mqtt/disconnect', (req, res) => {
    mqttHandler.disconnect();
    res.json({ success: true, message: 'Disconnected' });
});

// ---------- Controller API ----------

// List available controllers
app.get('/api/controllers', (req, res) => {
    res.json(controllerRegistry.listControllers());
});

// Get active controller
app.get('/api/controller', (req, res) => {
    const controller = controllerRegistry.getController(activeController);
    const adcMax = controllerRegistry.getAdcMaxValue(activeController);
    res.json({
        key: activeController,
        label: controller?.label,
        pins: controllerRegistry.getAllPins(activeController),
        adcMax
    });
});

// Get controller pins
app.get('/api/pins', (req, res) => {
    const pins = controllerRegistry.getAllPins(activeController);
    const assignments = pinManager.getAllAssignments();

    // Mark which pins are assigned
    const pinsWithStatus = pins.map((pin: any) => {
        const assignment = pinManager.getAssignment(`${pin.id}_${pin.pin}`);
        return {
            ...pin,
            assigned: !!assignment,
            sensorId: assignment?.sensorId
        };
    });

    res.json(pinsWithStatus);
});

// ---------- Sensor API ----------

// List available sensors
app.get('/api/sensors', (req, res) => {
    res.json(sensorRegistry.listSensors());
});

// Get sensor details
app.get('/api/sensor/:id', (req, res) => {
    const sensor = sensorRegistry.getSensor(req.params.id);
    if (!sensor) {
        return res.status(404).json({ success: false, error: 'Sensor not found' });
    }
    res.json(sensor);
});

// ---------- Pin Assignment API ----------

// Get current assignments with controller-aware ADC limits
app.get('/api/assignments', (req, res) => {
    const adcMax = controllerRegistry.getAdcMaxValue(activeController);
    const assignments = pinManager.getAllAssignments();

    // Override ADC limits with controller-specific max
    const assignmentsWithAdcLimits = assignments.map((a: any) => ({
        ...a,
        limits: a.hardwareCmd === 'ANALOG'
            ? { min: 0, max: adcMax, unit: 'adc' }
            : a.limits
    }));

    res.json(assignmentsWithAdcLimits);
});

// Assign sensor to pin(s)
app.post('/api/assign', (req, res) => {
    const { sensorId, pins, addr, slaveId } = req.body;
    if (!sensorId || !pins || !Array.isArray(pins)) {
        return res.status(400).json({ success: false, error: 'Missing sensorId or pins' });
    }

    const success = pinManager.assignSensor(sensorId, pins, addr, slaveId);
    if (success) {
        res.json({ success: true, sensorId, pins });
    } else {
        res.status(400).json({ success: false, error: 'Failed to assign sensor' });
    }
});

// Unassign pin
app.delete('/api/assign/:pin', (req, res) => {
    pinManager.unassignPin(req.params.pin);
    res.json({ success: true });
});

// Update sensor value
app.post('/api/value/:pin', (req, res) => {
    const { pin } = req.params;
    const { key, value } = req.body;

    pinManager.setValue(pin, key || 'value', value);

    // If updating 'state', also update DeviceState for DIGITAL_READ
    if (key === 'state' || key === 'value') { // 'value' is sometimes used? Actuator config says 'state'.
        // Assuming value is 0 or 1 for relays
        if (value === 0 || value === 1) {
            deviceState.setRelayState(pin, value);
        }
    }
    res.json({ success: true, pin, key, value });
});

// Update calibration points
app.post('/api/assign/:pin/calibration', (req, res) => {
    const { pin } = req.params;
    const { points } = req.body;

    if (!Array.isArray(points)) {
        return res.status(400).json({ success: false, error: 'Points must be an array' });
    }

    pinManager.setCalibration(pin, points);
    res.json({ success: true });
});

// Configure simulation
app.post('/api/assign/:pin/simulation', (req, res) => {
    const { pin } = req.params;
    const config = req.body;

    // config should match SimulationConfig interface
    pinManager.setSimulation(pin, config);
    res.json({ success: true });
});

// Update sensor label
app.post('/api/assign/:pin/label', (req, res) => {
    const { pin } = req.params;
    const { label } = req.body;
    pinManager.setLabel(pin, label);
    res.json({ success: true });
});

// Update multi-channel calibration
app.post('/api/assign/:pin/multi-calibration', (req, res) => {
    const { pin } = req.params;
    const { index, points } = req.body;
    if (index === undefined || !Array.isArray(points)) {
        return res.status(400).json({ success: false, error: 'Missing index or points' });
    }
    pinManager.setMultiCalibration(pin, Number(index), points);
    res.json({ success: true });
});

// Update multi-channel value
app.post('/api/assign/:pin/multi-value', (req, res) => {
    const { pin } = req.params;
    const { index, value } = req.body;
    if (index === undefined || value === undefined) {
        return res.status(400).json({ success: false, error: 'Missing index or value' });
    }
    pinManager.setMultiValue(pin, Number(index), Number(value));
    res.json({ success: true });
});

// Remove multi-channel index
app.delete('/api/assign/:pin/multi-value/:index', (req, res) => {
    const { pin, index } = req.params;
    if (index === undefined) {
        return res.status(400).json({ success: false, error: 'Missing index' });
    }
    pinManager.removeMultiValue(pin, Number(index));
    res.json({ success: true });
});

// Update multi-channel label
app.post('/api/assign/:pin/multi-label', (req, res) => {
    const { pin } = req.params;
    const { index, label } = req.body;
    if (index === undefined || label === undefined) {
        return res.status(400).json({ success: false, error: 'Missing index or label' });
    }
    pinManager.setMultiLabel(pin, Number(index), label);
    res.json({ success: true });
});

// Reorder sensor assignments
app.post('/api/assignments/reorder', (req, res) => {
    const { order } = req.body; // Array of pin IDs
    if (!Array.isArray(order)) {
        return res.status(400).json({ success: false, error: 'Order must be an array of pins' });
    }
    pinManager.reorderAssignments(order);
    res.json({ success: true });
});

// ---------- State API ----------

app.get('/api/state', (req, res) => {
    res.json({
        controller: activeController,
        assignments: pinManager.getAllAssignments(),
        uptime: deviceState.getUptime(),
        isOffline: deviceState.getIsOffline()
    });
});

// ---------- Scenario API ----------

// ---------- Scenario API ----------

app.get('/api/scenarios', (req, res) => {
    res.json(scenarioEngine.getScenarios());
});

app.post('/api/scenarios', (req, res) => {
    scenarioEngine.addScenario(req.body);
    res.json({ success: true });
});

app.delete('/api/scenarios/:id', (req, res) => {
    scenarioEngine.deleteScenario(req.params.id);
    res.json({ success: true });
});

app.post('/api/scenarios/:id/start', (req, res) => {
    try {
        scenarioEngine.startScenario(req.params.id);
        res.json({ success: true, scenarioId: req.params.id });
    } catch (e: any) {
        res.status(404).json({ success: false, error: e.message });
    }
});

app.post('/api/scenarios/stop', (req, res) => {
    scenarioEngine.stopScenario();
    res.json({ success: true });
});

app.get('/api/scenarios/status', (req, res) => {
    res.json(scenarioEngine.getStatus());
});

// ---------- Closed-Loop Reactive Physics API ----------

app.get('/api/closed-loop', (req, res) => {
    res.json({
        running: scenarioEngine.isReactiveLoopRunning(),
        rules: scenarioEngine.getClosedLoopRules()
    });
});

app.post('/api/closed-loop/rules', (req, res) => {
    scenarioEngine.setClosedLoopRule(req.body);
    res.json({ success: true });
});

app.delete('/api/closed-loop/rules/:id', (req, res) => {
    scenarioEngine.deleteClosedLoopRule(req.params.id);
    res.json({ success: true });
});

app.post('/api/closed-loop/toggle', (req, res) => {
    if (scenarioEngine.isReactiveLoopRunning()) {
        scenarioEngine.stopReactiveLoop();
    } else {
        scenarioEngine.startReactiveLoop();
    }
    res.json({ success: true, running: scenarioEngine.isReactiveLoopRunning() });
});

// ---------- Config Persistence ----------

app.get('/api/config/export', (req, res) => {
    res.json({
        controller: activeController,
        assignments: pinManager.exportConfig()
    });
});

app.post('/api/config/import', (req, res) => {
    const { config } = req.body;
    if (!Array.isArray(config)) {
        return res.status(400).json({ success: false, error: 'Invalid config format' });
    }
    pinManager.importConfig(config);
    res.json({ success: true });
});

app.post('/api/reset', (req, res) => {
    pinManager.reset();
    res.json({ success: true });
});


// ============ Setup & Main ============

let isConfigured = false;
let configuredUdpPort: number | null = null;

// Status Endpoint
app.get('/api/status', (req, res) => {
    res.json({
        configured: isConfigured,
        activeController,
        udpPort: configuredUdpPort,
        mqttUrl: controllerConfig.mqttUrl,
        httpPort: httpPort,
        mac: controllerConfig.mac,
        mqttTopicId: controllerConfig.mqttTopicId,
        mqttConnected: mqttHandler['client']?.connected || false,
        profileId: controllerConfig.id,
        profileName: controllerConfig.name
    });
});

// Setup Endpoint
// Profiles API
app.get('/api/profiles', (req, res) => {
    res.json(profileManager.listProfiles());
});

app.post('/api/profiles', (req, res) => {
    const profile = req.body;
    // Validate basics
    if (!profile.name || !profile.controllerType) {
        return res.status(400).json({ success: false, error: 'Name and Type are required' });
    }

    // Generate ID if missing
    if (!profile.id) {
        profile.id = profile.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    }

    // Ensure data exists
    if (!profile.created) profile.created = new Date().toISOString();

    if (profileManager.saveProfile(profile)) {
        res.json({ success: true, profile });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save profile' });
    }
});

app.delete('/api/profiles/:id', (req, res) => {
    if (profileManager.deleteProfile(req.params.id)) {
        res.json({ success: true });
    } else {
        res.status(500).json({ success: false, error: 'Failed to delete profile' });
    }
});

// ---------- Simulator Profiles API ----------

app.get('/api/profiles', (req, res) => {
    res.json(profileManager.listProfiles());
});

app.post('/api/profiles', (req, res) => {
    const profile = req.body;

    // Auto-generate ID if missing
    if (!profile.id) {
        profile.id = (profile.name || 'new-profile').toLowerCase().replace(/[^a-z0-9]/g, '-');
    }

    // Ensure unique ID
    let finalId = profile.id;
    let counter = 1;
    while (profileManager.getProfile(finalId)) {
        finalId = `${profile.id}-${counter++}`;
    }
    profile.id = finalId;

    if (profileManager.saveProfile(profile)) {
        res.json({ success: true, profile });
    } else {
        res.status(500).json({ success: false, error: 'Failed to save profile' });
    }
});

app.delete('/api/profiles/:id', (req, res) => {
    const { id } = req.params;
    if (profileManager.deleteProfile(id)) {
        res.json({ success: true });
    } else {
        res.status(404).json({ success: false, error: 'Profile not found' });
    }
});

app.put('/api/profiles/:id', (req, res) => {
    const { id } = req.params;
    const updates = req.body;

    const existing = profileManager.getProfile(id);
    if (!existing) {
        return res.status(404).json({ success: false, error: 'Profile not found' });
    }

    // Merge updates
    const updated = { ...existing, ...updates, id }; // Ensure ID doesn't change

    if (profileManager.saveProfile(updated)) {
        // If this is the active controller, update the runtime config if possible
        if (activeController === existing.controllerType && controllerConfig.id === id) {
            // We can update mundane things like mqttUrl immediately
            if (updates.mqttUrl) controllerConfig.mqttUrl = updates.mqttUrl;
            if (updates.mqttTopicId) controllerConfig.mqttTopicId = updates.mqttTopicId;
            // Port/MAC require restart, handled by client reconnecting usually
        }
        res.json({ success: true, profile: updated });
    } else {
        res.status(500).json({ success: false, error: 'Failed to update profile' });
    }
});

// Setup Endpoint
app.post('/api/setup', async (req, res) => {
    if (isConfigured) {
        return res.status(400).json({ success: false, error: 'Already configured' });
    }

    // Support both manual setup and profile-based setup
    let config: SimulatorProfile = { ...req.body };
    const { profileId } = req.body;

    if (profileId) {
        const profile = profileManager.getProfile(profileId);
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        config = profile;
        // Update last used
        profileManager.saveProfile(profile);
    }

    const { controllerType, udpPort, mac, name, mqttUrl } = config;
    // Normalized check (UI might send "controller" instead of "controllerType" for manual)
    const ctrlType = controllerType || req.body.controller;
    const port = parseInt(udpPort as any);

    // Validate Controller
    const ctrl = controllerRegistry.getController(ctrlType);
    if (!ctrl) {
        return res.status(400).json({ success: false, error: 'Invalid controller' });
    }

    // Validate Port
    if (isNaN(port) || port < 1024 || port > 65535) {
        return res.status(400).json({ success: false, error: 'Invalid UDP port' });
    }

    try {
        // Apply Config
        controllerConfig.id = config.id || (name ? name.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'manual');
        controllerConfig.name = name || 'Manual Session';
        controllerConfig.controllerType = ctrlType;
        controllerConfig.udpPort = port;
        controllerConfig.mac = mac || 'SIM:00:00:00:00:01';
        controllerConfig.mqttTopicId = config.mqttTopicId;
        controllerConfig.mqttUrl = mqttUrl;

        // Update active controller for API
        activeController = ctrlType;

        // Save Profile if Name is provided and it's not a temporary manual session
        if (name && !profileId) {
            const newProfile: SimulatorProfile = {
                id: controllerConfig.id,
                name: controllerConfig.name,
                controllerType: controllerConfig.controllerType,
                udpPort: controllerConfig.udpPort,
                mac: controllerConfig.mac,
                mqttUrl: mqttUrl,
                mqttTopicId: config.mqttTopicId,
                created: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            };
            profileManager.saveProfile(newProfile);
            console.log(`[Setup] Created new profile: ${newProfile.name} (${newProfile.id})`);
        }

        // Set Pin Manager Profile
        // If profileId exists, use it. If not, use the newly generated ID if creating one.
        // Fallback to "manual_TYPE" only if absolutely necessary
        const pinConfigId = profileId || controllerConfig.id;
        pinManager.setConfigProfile(pinConfigId);

        // Start UDP
        await startUdpServer(port);
        configuredUdpPort = port;

        if (mqttUrl) {
            mqttHandler.connect(mqttUrl, config.mqttTopicId);

            // Start telemetry loop (every 5 seconds)
            if ((global as any).telemetryInterval) clearInterval((global as any).telemetryInterval);
            (global as any).telemetryInterval = setInterval(() => {
                const assignments = pinManager.getAllAssignments();
                if (assignments.length > 0) {
                    const telemetryData: Record<string, any> = {};
                    assignments.forEach(a => {
                        // Support multi-key sensors
                        Object.entries(a.values).forEach(([key, val]) => {
                            const name = a.pins.length > 1 ? `${a.sensorId}_${key}` : a.sensorId;
                            telemetryData[name] = val;
                        });
                    });
                    mqttHandler.publishTelemetry(telemetryData);
                }
            }, 5000);
        }

        isConfigured = true;

        console.log(`[Setup] Configured: ${activeController} (${controllerConfig.mac}) on UDP ${configuredUdpPort}`);
        res.json({ success: true, profileId: controllerConfig.id });

    } catch (e: any) {
        console.error('[Setup] Error:', e);
        if (e.code === 'EADDRINUSE') {
            return res.status(400).json({ success: false, error: `Port ${port} is busy. Please try another.` });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

app.post('/api/reconfigure', (req, res) => {
    console.log('[Setup] Reconfigure requested.');

    if (udpServer) {
        try {
            udpServer.close();
        } catch (e) { console.error('Error closing UDP:', e); }
        udpServer = null;
    }

    mqttHandler.disconnect();

    if ((global as any).telemetryInterval) {
        clearInterval((global as any).telemetryInterval);
        (global as any).telemetryInterval = null;
    }

    isConfigured = false;
    configuredUdpPort = null;

    res.json({ success: true });
});

app.post('/api/mqtt/update', (req, res) => {
    const { mqttUrl, mqttTopicId } = req.body;

    if (mqttUrl !== undefined) controllerConfig.mqttUrl = mqttUrl;
    if (mqttTopicId !== undefined) controllerConfig.mqttTopicId = mqttTopicId;

    // If connected, reconnect with new settings
    if (controllerConfig.mqttUrl) {
        mqttHandler.connect(controllerConfig.mqttUrl, controllerConfig.mqttTopicId);

        // Restart telemetry loop with new settings
        if ((global as any).telemetryInterval) clearInterval((global as any).telemetryInterval);
        (global as any).telemetryInterval = setInterval(() => {
            const assignments = pinManager.getAllAssignments();
            if (assignments.length > 0) {
                const telemetryData: Record<string, any> = {};
                assignments.forEach(a => {
                    Object.entries(a.values).forEach(([key, val]) => {
                        const name = a.pins.length > 1 ? `${a.sensorId}_${key}` : a.sensorId;
                        telemetryData[name] = val;
                    });
                });
                mqttHandler.publishTelemetry(telemetryData);
            }
        }, 5000);
    }

    res.json({
        success: true,
        mqttUrl: controllerConfig.mqttUrl,
        mqttTopicId: controllerConfig.mqttTopicId
    });
});

// Serve React App (Production Build)
// Determine path: priority to 'www' folder in current working directory
const cwd = process.cwd();
const localWwwPath = path.join(cwd, 'www');
const isPkg = (process as any).pkg !== undefined;

const clientDistPath = fs.existsSync(localWwwPath)
    ? localWwwPath
    : (isPkg
        ? path.join(path.dirname(process.execPath), 'www')
        : path.join(_dirname, '../dist'));

console.log(`[Startup] Serving frontend from: ${clientDistPath}`);

app.use(express.static(clientDistPath));

// Fallback for SPA routing (must be last)
app.use((req, res, next) => {
    // Skip API requests to avoid returning HTML for 404 APIs
    if (req.path.startsWith('/api')) return next();

    const indexPath = path.join(clientDistPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            next();
        }
    });
});

function startHttpServer(port: number) {
    const server = app.listen(port, () => {
        httpPort = port;
        console.log('[Startup] Web-based Setup Mode');
        console.log(`[HTTP] Server listening on port ${port}`);
        console.log(`[Info] Open http://localhost:${port} to configure and start the simulator.`);
    });

    server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`[Startup] Port ${port} is busy, trying ${port + 1}...`);
            startHttpServer(port + 1);
        } else {
            console.error('[Startup] Failed to start HTTP server:', err);
            process.exit(1);
        }
    });
}

async function autoStartIfConfigured() {
    const autoProfileId = process.env.PROFILE || (process.env.AUTO_START === 'true' ? 'demo_showcase' : null);
    if (!autoProfileId) return;

    const profile = profileManager.getProfile(autoProfileId) || profileManager.listProfiles().find(p => p.id === autoProfileId) || profileManager.listProfiles()[0];
    if (profile) {
        console.log(`[AutoStart] Auto-booting profile: ${profile.name} (${profile.id}) on UDP ${profile.udpPort}`);
        try {
            activeController = profile.controllerType;
            controllerConfig.id = profile.id;
            controllerConfig.name = profile.name;
            controllerConfig.controllerType = profile.controllerType;
            controllerConfig.udpPort = profile.udpPort;
            controllerConfig.mac = profile.mac;
            pinManager.setConfigProfile(profile.id);
            await startUdpServer(profile.udpPort);
            configuredUdpPort = profile.udpPort;
            isConfigured = true;
            console.log(`[AutoStart] Simulator active & listening on UDP port ${profile.udpPort}`);
        } catch (e) {
            console.error('[AutoStart] Failed to auto-start profile:', e);
        }
    }
}

function main() {
    startHttpServer(httpPort);
    autoStartIfConfigured();
}

main();
