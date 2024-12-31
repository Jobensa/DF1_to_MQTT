"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/index.ts
//import { DF1MqttGateway } from './gateway';
const df1_service_1 = require("./df1-service"); // Adjust the path as necessary
const logger_1 = require("./utils/logger");
const mqtt_service_1 = require("./mqtt-service"); // Adjust the path as necessary
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// Cargar configuración
const config = loadConfig();
logger_1.logger.info('Loading configuration:', config);
let df1Service = new df1_service_1.DF1Service(config);
let mqttService = new mqtt_service_1.MQTTService(config);
//let tagData =config.tags[0];
let dataTags = new Map();
async function main() {
    // Handle DF1 data updates
    df1Service.on('tagData', (data) => {
        //tagData = data;
        dataTags.set(data.name, data);
        //mqttService.publishTagData(data.tag, data.status, data.value);
    });
    startMQTT(config);
}
async function startMQTT(params) {
    // Publish tagData periodically every 1000 ms
    setInterval(() => {
        if (dataTags.size === 0) {
            // If no tagData received, send empty value and status "fail"
            mqttService.publishTagData('unknown', 'fail', {});
            dataTags.clear();
            console.log("No Datos", dataTags.size);
        }
        else {
            // Publish the received tagData
            console.log("No Datos", dataTags.size);
            for (let tag of dataTags.values()) {
                //console.log("Tag",tag);
                mqttService.publishTagData(tag.name, "OK", tag.value);
            }
            dataTags.clear();
        }
    }, 1000);
    // Handle MQTT write requests
    mqttService.on('writeRequest', async (data) => {
        try {
            await df1Service.writeTag(data.tagName, data.value);
        }
        catch (error) {
            logger_1.logger.error('Failed to write tag:', error);
        }
    });
    mqttService.on('error', (error) => {
        logger_1.logger.error('Main MQTT Service error:', error);
        mqttService.end();
    });
}
// Mejorar el manejo de errores no capturados
process.on('uncaughtException', (error) => {
    logger_1.logger.error('Uncaught exception:', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});
process.on('unhandledRejection', (reason) => {
    logger_1.logger.error('Unhandled rejection:', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    });
    process.exit(1);
});
function loadConfig() {
    const configPath = path_1.default.resolve(__dirname, './config/default.json');
    try {
        const configFile = fs_1.default.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configFile);
        return config;
    }
    catch (error) {
        logger_1.logger.error('Failed to load configuration:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
}
main().catch(error => {
    logger_1.logger.error('Unhandled error in main:', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});
