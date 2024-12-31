"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MQTTService = void 0;
const mqtt = __importStar(require("mqtt"));
const events_1 = require("events");
const logger_1 = require("./utils/logger");
const MAX_RETRIES = Infinity; // Infinite retries
const RETRY_DELAY = 10000; // 10 seconds
class MQTTService extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.retries = 0;
        this.dataTags = new Map();
        this.config = config;
        this.connectToBroker();
    }
    async connectToBroker() {
        this.mqttClient = connect({
            brokerUrl: this.config.mqtt.brokerUrl, options: {
                clientId: this.config.mqtt.clientId,
                username: this.config.mqtt.username,
                password: this.config.mqtt.password,
                clean: true,
                reconnectPeriod: RETRY_DELAY, // Reconnect every 5 seconds
                connectTimeout: 30 * 1000, // 30 seconds timeout
                keepalive: 60, // Keepalive interval in seconds
                resubscribe: true
            }
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
            }
            else {
                console.error('Exceeded maximum retries for MQTT Broker connection');
            }
        });
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
    async end() {
        this.mqttClient.end();
        this.mqttClient != null;
        await new Promise(resolve => setTimeout(resolve, 5000));
        //setTimeout(() =>this.connectToBroker(), RETRY_DELAY);
    }
}
exports.MQTTService = MQTTService;
function connect({ brokerUrl, options }) {
    return mqtt.connect(brokerUrl, options);
}
