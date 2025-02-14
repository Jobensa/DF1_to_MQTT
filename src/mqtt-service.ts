import * as mqtt from 'mqtt';
import { MqttClient } from 'mqtt';
import { EventEmitter } from 'events';
import { logger } from './utils/logger';
//import { Tag } from './interfaces/tag.interface';

const MAX_RETRIES = Infinity; // Infinite retries
const RETRY_DELAY = 10000; // 10 seconds

export class MQTTService extends EventEmitter {
    // private this.mqttClient!: this.mqttClient;
    private config: any;
    private retries = 0;
    private mqttClient!: MqttClient;

   

    constructor(config: any) {
        super();
        this.config = config;
        this.connectToBroker();
    }

    private async connectToBroker() {
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

        this.mqttClient.on('error', (error: Error) => {
            logger.error('MQTT Client Error:', error);
            if (this.retries < MAX_RETRIES) {
                this.retries++;
                console.log(`Retrying to connect to MQTT Broker (attempt ${this.retries})...`);
                
            } else {
                console.error('Exceeded maximum retries for MQTT Broker connection');
            }
        });
    }


    public publishTagData(tagName: string, status: string, value: any) {
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
        this.mqttClient!= null;
        await new Promise(resolve => setTimeout(resolve, 5000));
        //setTimeout(() =>this.connectToBroker(), RETRY_DELAY);
    }

   
}




function connect({ brokerUrl, options }: {
    brokerUrl: string; options: {
        clientId: string;
        username: string;
        password: string;
        clean: boolean;
        reconnectPeriod: number;
        connectTimeout: number;
        keepalive: number;
        resubscribe: boolean;
    };
}): mqtt.MqttClient {
    return mqtt.connect(brokerUrl, options);
}

