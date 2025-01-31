// df1-service.ts
import { DF1Protocol } from './protocols/df1-protocol';
import { EventEmitter } from 'events';
import { logger } from './utils/logger';
import { TagConfig, GatewayConfig } from './interfaces/config.interface';




const MAX_RETRIES = 10;
const RETRY_DELAY = 3000; // 1 second
//const MAX_RECONNECT_ATTEMPTS = 5; // Define the maximum number of reconnection attempts
export class DF1Service extends EventEmitter {
    private df1?: DF1Protocol;
    private config: GatewayConfig;
    //private running: boolean = false;
    private pollIntervals: Map<string, NodeJS.Timeout> = new Map();

    constructor(config: GatewayConfig) {
        super();
        this.config = config;
        this.initialize();
    }
    private async initialize() {
        try {
            this.df1 = await this.initializeDF1Protocol(this.config);
            this.setupEventHandlers();
            console.log('DF1 Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize DF1 Service:', {
                error: (error as Error).message,
                stack: (error as Error).stack
            });
            process.exit(1);
        }
    }


    private setupEventHandlers(): void {
        this.df1?.on('connected', (connected: boolean) => {
            console.log('DF1 connected event received:', connected);
            if (this.df1?.getIsOpen() && connected) {
                this.startPolling();
            } else {
                // Handle disconnection
                this.stopPolling();
                this.initialize();
            }
        });

        this.df1?.on('error', async (error: Error) => {
            logger.error('DF1 Protocol Error:', error);
            // Handle error appropriately
            this.stopPolling();
            await new Promise(resolve => setTimeout(resolve, 1000));
            this.initialize();
        });
    }

    private async pollTag(tag: TagConfig): Promise<void> {
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
        } catch (error) {
            this.emit('error', error);
            throw new Error(`Failed to poll tag: ${tag.name}. Original error: ${error instanceof Error ? error.message : error}`);
        }
    }


    private startPolling(): void {
        console.log('Starting polling');

        for (const tag of this.config.tags) {
            const interval = setInterval(() => {
                this.pollTag(tag);
            }, tag.pollRate);

            this.pollIntervals.set(tag.name, interval);
        }
    }

    private stopPolling(): void {
        for (const interval of this.pollIntervals.values()) {
            clearInterval(interval);
        }
        
        this.pollIntervals.clear();
        this.df1?.stop();
        this.df1?.removeAllListeners();
    }

    // ... (rest of the DF1 formatting methods remain the same)

    private parseWriteValue(address: string, value: string): number[] {
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

    private formatReadValue(address: string, data: number[]): string{
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

    public async writeTag(tagName: string, value: any): Promise<void> {
        const tag = this.config.tags.find(t => t.name === tagName);
        if (!tag || !tag.writeable) {
            throw new Error(`Invalid write attempt to tag: ${tagName}`);
        }

        const values = this.parseWriteValue(tag.address, value);
        await this.df1?.writeData(tag.address, values);
    }


    async initializeDF1Protocol(config: any): Promise<DF1Protocol> {
        let attempt = 0;

        while (attempt < MAX_RETRIES) {
            try {
                const df1Protocol = new DF1Protocol({
                    port: config.df1.port,
                    baudRate: config.df1.baudRate
                });
                await df1Protocol.start();
                while (!df1Protocol.getIsOpen()) {
                    logger.info('DF1 Protocol initialized successfully');
                    return df1Protocol;
                }
            } catch (error) {
                attempt++;
                logger.error(`Failed to initialize DF1 Protocol (attempt ${attempt}):`, {
                    error: (error as Error).message,
                    stack: (error as Error).stack
                });
                if (attempt < MAX_RETRIES) {
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * attempt));
                } else {
                    throw new Error('Exceeded maximum retries for DF1 Protocol initialization');
                }
            }
        }
        throw new Error('Failed to initialize DF1 Protocol');
    }


}






