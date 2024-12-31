// src/index.ts
//import { DF1MqttGateway } from './gateway';
import { DF1Service } from './df1-service'; // Adjust the path as necessary
import { logger } from './utils/logger';
import { MQTTService } from './mqtt-service'; // Adjust the path as necessary
import fs from 'fs';
import path from 'path';
import { Tag } from './interfaces/tag.interface';

// Cargar configuración
const config = loadConfig();
logger.info('Loading configuration:', config);
let df1Service = new DF1Service(config);
let mqttService = new MQTTService(config);
//let tagData =config.tags[0];
let dataTags: Map<string, Tag> = new Map();

async function main() {

    // Handle DF1 data updates
    df1Service.on('tagData', (data) => {
        //tagData = data;
        dataTags.set(data.name, data);
        //mqttService.publishTagData(data.tag, data.status, data.value);
    });

    startMQTT(config);

}

async function startMQTT(params:any) {
    // Publish tagData periodically every 1000 ms
    setInterval(() => {
        if (dataTags.size === 0) {
            // If no tagData received, send empty value and status "fail"
            mqttService.publishTagData('unknown', 'fail', {});
            dataTags.clear();
            console.log("No Datos",dataTags.size);
        } else {
            // Publish the received tagData

            console.log("No Datos",dataTags.size);

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
        } catch (error) {
            logger.error('Failed to write tag:', error);
        }
    });

    mqttService.on('error', (error) => {
        logger.error('Main MQTT Service error:', error);
        mqttService.end();        
    });
    
}


// Mejorar el manejo de errores no capturados
process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception:', {
        error: error.message,
        stack: error.stack
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason: any) => {
    logger.error('Unhandled rejection:', {
        reason: reason instanceof Error ? reason.message : String(reason),
        stack: reason instanceof Error ? reason.stack : undefined
    });
    process.exit(1);
});


function loadConfig() {
    const configPath = path.resolve(__dirname, './config/default.json');
    try {
        const configFile = fs.readFileSync(configPath, 'utf-8');
        const config = JSON.parse(configFile);
        return config;
    } catch (error) {
        logger.error('Failed to load configuration:', {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        });
        throw error;
    }
}


main().catch(error => {
    logger.error('Unhandled error in main:', {
        error: (error as Error).message,
        stack: (error as Error).stack
    });
    process.exit(1);
});