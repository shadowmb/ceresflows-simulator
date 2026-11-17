import mqtt from 'mqtt';
import { ProtocolHandler } from './ProtocolHandler.js';

export class MqttHandler {
    private client: mqtt.MqttClient | null = null;
    private protocolHandler: ProtocolHandler;
    private mac: string;
    private clientId: string;
    private topicPrefix: string = 'hydro';

    constructor(protocolHandler: ProtocolHandler, mac: string, mqttTopicId?: string) {
        this.protocolHandler = protocolHandler;
        this.mac = mac;
        // Priority: Custom ID > Alphanumeric mac for topic (SIM:01 -> SIM01)
        this.clientId = mqttTopicId || mac.replace(/[^a-zA-Z0-9]/g, '');
        console.log(`[MQTT] Init for ${this.clientId}`);
    }

    public connect(brokerUrl: string, mqttTopicId?: string): void {
        if (mqttTopicId) {
            this.clientId = mqttTopicId;
        }

        if (this.client) {
            this.client.end();
        }

        console.log(`[MQTT] Connecting to ${brokerUrl} with ID ${this.clientId}...`);

        this.client = mqtt.connect(brokerUrl, {
            clientId: `sim_${this.clientId}_${Math.floor(Math.random() * 1000)}`, // Unique client ID
            will: {
                topic: `${this.topicPrefix}/${this.clientId}/status`,
                payload: 'offline',
                qos: 1,
                retain: true
            }
        });

        this.client.on('connect', () => {
            console.log('[MQTT] Connected successfully');
            if (this.onLog) this.onLog({ type: 'info', message: 'MQTT Connected' });

            this.client?.subscribe(`${this.topicPrefix}/${this.clientId}/cmd`, (err) => {
                if (!err) {
                    console.log(`[MQTT] Subscribed to: ${this.topicPrefix}/${this.clientId}/cmd`);
                    if (this.onLog) this.onLog({ type: 'info', message: `Subscribed: ${this.topicPrefix}/${this.clientId}/cmd` });
                    this.publishStatus('online');
                } else {
                    console.error('[MQTT] Subscription error:', err);
                    if (this.onLog) this.onLog({ type: 'error', message: `MQTT Sub Error: ${err.message}` });
                }
            });
        });

        this.client.on('message', (topic, message) => {
            this.handleMessage(topic, message);
        });

        this.client.on('error', (err) => {
            console.error('[MQTT] Connection error:', err.message);
            if (this.onLog) this.onLog({ type: 'error', message: `MQTT Error: ${err.message}` });
        });

        this.client.on('close', () => {
            console.log('[MQTT] Connection closed');
            if (this.onLog) this.onLog({ type: 'info', message: 'MQTT Disconnected' });
        });
    }

    public disconnect(): void {
        if (this.client) {
            this.publishStatus('offline');
            this.client.end();
            this.client = null;
            console.log('[MQTT] Disconnected');
        }
    }

    public publishStatus(status: 'online' | 'offline'): void {
        const topic = `${this.topicPrefix}/${this.clientId}/status`;
        console.log(`[MQTT] Publishing status: ${status} to ${topic}`);
        this.client?.publish(topic, status, { retain: true, qos: 1 }, (err) => {
            if (err) console.error(`[MQTT] Status publish failed:`, err);
            else console.log(`[MQTT] Status published: ${status}`);
        });
    }

    public publishTelemetry(data: any): void {
        if (!this.client?.connected) return;

        const topic = `${this.topicPrefix}/${this.clientId}/telemetry`;
        const payload = JSON.stringify(data);

        this.client.publish(topic, payload, { qos: 0 }, (err) => {
            if (err) console.error(`[MQTT] Telemetry publish failed:`, err);
            else {
                // console.log(`[MQTT] Telemetry published to ${topic}`);
            }
        });
    }

    private onLog?: (entry: any) => void;

    public setLogCallback(cb: (entry: any) => void) {
        this.onLog = cb;
    }

    private handleMessage(topic: string, message: Buffer): void {
        const payload = message.toString();
        console.log(`[MQTT] Received command on ${topic}: ${payload}`);

        if (this.onLog) {
            this.onLog({
                type: 'incoming',
                from: `MQTT:${topic}`,
                command: payload,
                timestamp: new Date().toISOString()
            });
        }

        // Route to protocol handler
        const response = this.protocolHandler.handleCommand(payload);

        if (response) {
            const responseStr = typeof response === 'string' ? response : JSON.stringify(response);
            const resTopic = `${this.topicPrefix}/${this.clientId}/res`;

            console.log(`[MQTT] Sending response to ${resTopic}`);
            this.client?.publish(resTopic, responseStr, { qos: 0 });

            if (this.onLog) {
                this.onLog({
                    type: 'outgoing',
                    response: responseStr,
                    timestamp: new Date().toISOString()
                });
            }
        }
    }
}
