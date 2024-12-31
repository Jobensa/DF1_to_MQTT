"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MQTTService = exports.DF1MqttGateway = void 0;
const df1_protocol_1 = require("./protocols/df1-protocol");
const mqtt_1 = require("mqtt");
const events_1 = require("events");
const logger_1 = require("./utils/logger");
const MAX_RETRIES = 10;
const RETRY_DELAY = 1000; // 1 second
const MAX_RECONNECT_ATTEMPTS = 5; // Define the maximum number of reconnection attempts
class DF1MqttGateway extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.running = false;
        this.pollIntervals = new Map();
        this.config = config;
        // Initialize MQTT Service
        this.mqttService = new MQTTService(config);
        this.initialize();
    }
    async initialize() {
        try {
            this.df1 = await initializeDF1Protocol(this.config);
            this.setupEventHandlers();
            logger_1.logger.info('Gateway initialized successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize Gateway:', {
                error: error.message,
                stack: error.stack
            });
            process.exit(1);
        }
    }
    setupEventHandlers() {
        // DF1 Event Handlers
        this.df1?.on('connected', (connected) => {
            console.log('DF1 connected event received:', connected);
            this.emit('df1Connected', connected);
            this.running = connected;
            if (this.df1?.getIsOpen() == 1) {
                this.startPolling();
                console.log('Polling started');
            }
            else {
                this.stopPolling();
                console.log('Polling stopped');
                this.df1?.removeAllListeners();
                this.initialize();
                this.mqttService.publishTagData('plc', 'failed', {});
            }
        });
        // Handle other events and errors
        this.df1?.on('error', (error) => {
            logger_1.logger.error('DF1 Protocol Error:', error);
            // Handle error appropriately
        });
        console.log('Event Handlers Iniciados.....');
    }
    setupSubscriptions() {
        // Subscribe to write requests for writable tags
        for (const tag of this.config.tags) {
            if (tag.writeable) {
                const writeTopic = `${this.config.mqtt.topicPrefix}/write/${tag.name}`;
                this.mqttService.mqttClient.subscribe(writeTopic);
            }
        }
    }
    async handleMqttMessage(topic, message) {
        try {
            // Extract tag name from topic
            const match = topic.match(new RegExp(`${this.config.mqtt.topicPrefix}/write/(.*)`));
            if (!match)
                return;
            const tagName = match[1];
            const tag = this.config.tags.find(t => t.name === tagName);
            if (!tag || !tag.writeable) {
                this.emit('error', new Error(`Invalid write attempt to tag: ${tagName}`));
                return;
            }
            // Parse the message based on tag type
            const values = this.parseWriteValue(tag.address, message.toString());
            // Write to PLC
            await this.df1?.writeData(tag.address, values);
            // Publish confirmation
            this.mqttService.mqttClient.publish(`${this.config.mqtt.topicPrefix}/writeConfirm/${tag.name}`, message);
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    parseWriteValue(address, value) {
        const type = address[0].toUpperCase();
        switch (type) {
            case 'N': // Integer
                const intValue = parseInt(value);
                return [(intValue >> 8) & 0xFF, intValue & 0xFF];
            case 'F': // Float
                const floatValue = parseFloat(value);
                const buffer = Buffer.alloc(4);
                buffer.writeFloatLE(floatValue, 0);
                return Array.from(buffer);
            default:
                throw new Error(`Unsupported data type for writing: ${type}`);
        }
    }
    formatReadValue(address, data) {
        const type = address[0].toUpperCase();
        switch (type) {
            case 'N': // Integer
                const int16Data = new Int16Array(new Uint8Array(data).buffer);
                return Array.from(int16Data).join(',');
            case 'F': // Float
                const float32Data = new Float32Array(new Uint8Array(data).buffer);
                return Array.from(float32Data).join(',');
            default:
                return data.join(',');
        }
    }
    async pollTag(tag) {
        try {
            const data = await this.df1?.readData(tag.address, tag.size);
            if (data) {
                const value = this.formatReadValue(tag.address, data);
                console.log(`${this.config.mqtt.topicPrefix}/data/${tag.name}`, value);
                this.mqttService.publishTagData(tag.name, 'OK', value);
            }
            else {
                console.log('No data received');
                this.mqttService.publishTagData(tag.name, 'failed', {});
            }
        }
        catch (error) {
            this.emit('error', error);
        }
    }
    startPolling() {
        console.log('Starting polling');
        for (const tag of this.config.tags) {
            const interval = setInterval(() => {
                this.pollTag(tag);
            }, tag.pollRate);
            this.pollIntervals.set(tag.name, interval);
        }
    }
    stopPolling() {
        for (const interval of this.pollIntervals.values()) {
            clearInterval(interval);
        }
        this.pollIntervals.clear();
    }
}
exports.DF1MqttGateway = DF1MqttGateway;
async function initializeDF1Protocol(config) {
    let attempt = 0;
    while (attempt < MAX_RETRIES) {
        try {
            const df1Protocol = new df1_protocol_1.DF1Protocol({
                port: config.df1.port,
                baudRate: config.df1.baudRate
            });
            await df1Protocol.start();
            logger_1.logger.info('DF1 Protocol initialized successfully');
            return df1Protocol;
        }
        catch (error) {
            attempt++;
            logger_1.logger.error(`Failed to initialize DF1 Protocol (attempt ${attempt}):`, {
                error: error.message,
                stack: error.stack
            });
            if (attempt < MAX_RETRIES) {
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
            }
            else {
                throw new Error('Exceeded maximum retries for DF1 Protocol initialization');
            }
        }
    }
    throw new Error('Failed to initialize DF1 Protocol');
}
class MQTTService extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.retries = 0;
        this.config = config;
        this.connectToBroker();
    }
    connectToBroker() {
        this.mqttClient = (0, mqtt_1.connect)(this.config.mqtt.brokerUrl, {
            clientId: this.config.mqtt.clientId,
            username: this.config.mqtt.username,
            password: this.config.mqtt.password,
            clean: true,
            reconnectPeriod: RETRY_DELAY, // Reconnect every 5 seconds
            connectTimeout: 30 * 1000, // 30 seconds timeout
            keepalive: 60, // Keepalive interval in seconds
            resubscribe: true // Resubscribe to topics on reconnection
        });
        this.mqttClient.on('connect', () => {
            console.log('MQTT Client connected');
            this.retries = 0; // Reset retries on successful connection
        });
        this.mqttClient.on('reconnect', () => {
            console.log('MQTT Client reconnecting');
        });
        this.mqttClient.on('close', () => {
            console.log('MQTT Client connection closed');
        });
        this.mqttClient.on('offline', () => {
            console.log('MQTT Client offline');
        });
        this.mqttClient.on('error', (error) => {
            logger_1.logger.error('MQTT Client Error:', error);
            if (this.retries < MAX_RETRIES) {
                this.retries++;
                console.log(`Retrying to connect to MQTT Broker (attempt ${this.retries})...`);
                setTimeout(() => this.connectToBroker(), RETRY_DELAY);
            }
            else {
                console.error('Exceeded maximum retries for MQTT Broker connection');
            }
        });
    }
    setupSubscriptions() {
        // Setup your subscriptions here
    }
    publishTagData(tagName, status, value) {
        const topic = `${this.config.mqtt.topicPrefix}/data/plc`;
        const message = {
            status,
            tag: tagName,
            value
        };
        this.mqttClient.publish(topic, JSON.stringify(message), {
            qos: 1,
            retain: false
        });
    }
}
exports.MQTTService = MQTTService;
