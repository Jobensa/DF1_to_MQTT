"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DF1Service = void 0;
// df1-service.ts
const df1_protocol_1 = require("./protocols/df1-protocol");
const events_1 = require("events");
const logger_1 = require("./utils/logger");
const MAX_RETRIES = 10;
const RETRY_DELAY = 3000; // 1 second
//const MAX_RECONNECT_ATTEMPTS = 5; // Define the maximum number of reconnection attempts
class DF1Service extends events_1.EventEmitter {
    constructor(config) {
        super();
        //private running: boolean = false;
        this.pollIntervals = new Map();
        this.config = config;
        this.initialize();
    }
    async initialize() {
        try {
            this.df1 = await this.initializeDF1Protocol(this.config);
            this.setupEventHandlers();
            console.log('DF1 Service initialized successfully');
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize DF1 Service:', {
                error: error.message,
                stack: error.stack
            });
            process.exit(1);
        }
    }
    setupEventHandlers() {
        this.df1?.on('connected', (connected) => {
            console.log('DF1 connected event received:', connected);
            if (this.df1?.getIsOpen() && connected) {
                this.startPolling();
            }
            else {
                // Handle disconnection
                this.stopPolling();
                this.initialize();
            }
        });
        this.df1?.on('error', async (error) => {
            logger_1.logger.error('DF1 Protocol Error:', error);
            // Handle error appropriately
            this.stopPolling();
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.initialize();
        });
    }
    async pollTag(tag) {
        try {
            if (!this.df1) {
                throw new Error('DF1 instance is not available');
            }
            const data = await this.df1.readData(tag.address, tag.size);
            this.emit('tagData', {
                name: tag.name,
                status: data ? 'OK' : 'failed',
                value: data ? this.formatReadValue(tag.address, data) : {}
            });
        }
        catch (error) {
            this.emit('error', error);
            throw new Error(`Failed to poll tag: ${tag.name}. Original error: ${error instanceof Error ? error.message : error}`);
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
        this.df1?.stop();
        this.df1?.removeAllListeners();
    }
    // ... (rest of the DF1 formatting methods remain the same)
    parseWriteValue(address, value) {
        const type = address[0].toUpperCase();
        switch (type) {
            case 'B': // Integer
                const binValue = parseInt(value);
                return [(binValue >> 8) & 0xFF, binValue & 0xFF];
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
            case 'B': // Integer
                const bin16Data = new Int16Array(new Uint8Array(data).buffer);
                return Array.from(bin16Data).join(',');
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
    async writeTag(tagName, value) {
        const tag = this.config.tags.find(t => t.name === tagName);
        if (!tag || !tag.writeable) {
            throw new Error(`Invalid write attempt to tag: ${tagName}`);
        }
        const values = this.parseWriteValue(tag.address, value);
        await this.df1?.writeData(tag.address, values);
    }
    async initializeDF1Protocol(config) {
        let attempt = 0;
        while (attempt < MAX_RETRIES) {
            try {
                const df1Protocol = new df1_protocol_1.DF1Protocol({
                    port: config.df1.port,
                    baudRate: config.df1.baudRate
                });
                await df1Protocol.start();
                while (!df1Protocol.getIsOpen()) {
                    logger_1.logger.info('DF1 Protocol initialized successfully');
                    return df1Protocol;
                }
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
}
exports.DF1Service = DF1Service;
