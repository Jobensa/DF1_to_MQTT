import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';

interface DF1Options {
    port: string;
    baudRate: number;
}

interface PendingTransaction {
    resolve: (value: Buffer | null) => void;
    reject: (reason: any) => void;
    timer: NodeJS.Timeout;
}

export class DF1Protocol extends EventEmitter {
    // DF1 command codes
    private static readonly CMD_READ = 0x0F;
    private static readonly CMD_WRITE = 0x0E;
    private dataTimeout: NodeJS.Timeout | null = null;

    // File types
    private static readonly FILE_TYPES: { [key: string]: number } = {
        'O': 0x8B,  // Output
        'I': 0x8C,  // Input
        'S': 0x84,  // Status
        'B': 0x85,  // Bit
        'T': 0x86,  // Timer
        'C': 0x87,  // Counter
        'R': 0x88,  // Control
        'N': 0x89,  // Integer
        'F': 0x8A,  // Float
    };

    private port: SerialPort;
    private running: boolean = false;
    private tns: number;
    private isConnecting: boolean = false;
   // private writeQueue: Buffer[] = [];
    private pendingTransactions: Map<number, PendingTransaction> = new Map();
    private buffer: Buffer = Buffer.alloc(0);
    private isOpen: number = 0;

    constructor(options: DF1Options) {
        super();
        this.tns = new Date().getSeconds() + 1;
        this.port = new SerialPort({
            path: options.port,
            baudRate: options.baudRate,
            dataBits: 8,
            parity: 'none',
            stopBits: 1,
            autoOpen: false
        });


    }

    public getIsOpen(): number {
        return this.isOpen && this.port.isOpen ? 1 : 0;
    }


    private async onDataReceived(data: Buffer): Promise<void> {
        // Concatenate the new data to the buffer
        this.buffer = Buffer.concat([this.buffer, data]);

        // Clear the previous timeout if it exists
        if (this.dataTimeout) {
            clearTimeout(this.dataTimeout);
        }

        // Set a new timeout to process the data after 100ms of no new data
        this.dataTimeout = setTimeout(() => {
            this.handleIncomingData(this.buffer);
            this.buffer = Buffer.alloc(0); // Clear the buffer after processing
        }, 100);
    }

    public async connect(): Promise<void> {
        while (this.running) {
            try {
                await this.openPort();
                return;
            } catch (err) {
                console.error('Error connecting to DF1:', err);
                await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 1 second before retrying
            }
        }
    }
    private async openPort(): Promise<void> {
        if (this.isOpen || this.isConnecting) {
            return;
        }

        this.isConnecting = true;

        return new Promise((resolve, reject) => {
            console.log('Connecting to DF1...');
            this.port.open((err) => {
                this.isConnecting = false;

                if (err) {
                    console.error('Error opening port:', err);
                    return reject(err);
                }

                this.isOpen = 1;
                this.running = true;
                this.port.on('data', this.onDataReceived.bind(this));
                this.port.on('error', this.handleError.bind(this));
                this.port.on('close', this.handleClose.bind(this));

                console.log('Serial port opened successfully');
                this.emit('connected', true);
                resolve();
            });
        });
    }


    private handleError(err: Error): void {
        console.error('Serial port error:', err);
        this.emit('error', err);
        this.running = false;
        this.isOpen = 0;
        setTimeout(() => this.connect(), 1000);
    }


    private handleClose(): void {
        console.log('Serial port closed');
        this.cleanUp();
        this.running = false;
        this.isOpen = 0;
        this.emit('connected', false);
        if (this.running) {
            setTimeout(() => this.connect(), 1000);
        }
    }


    private cleanUp(): void {
        if (this.port) {
            this.port.removeAllListeners('data');
            this.port.removeAllListeners('error');
            this.port.removeAllListeners('close');
        }
    }

    public async disconnect(): Promise<void> {
        if (this.isOpen && this.port) {
            return new Promise((resolve, reject) => {
                this.port.close((err) => {
                    if (err) {
                        console.error('Error closing port:', err);
                        this.emit('error', err);
                        return reject(err);
                    }

                    this.cleanUp();
                    this.running = false;
                    this.isOpen = 0;
                    this.emit('connected', false);
                    console.log('Disconnected from DF1');
                    resolve();
                });
            });
        }
    }

    private calcCRC(crc: number, buffer: number): number {
        let temp1 = crc ^ buffer;
        crc = (crc & 0xff00) | (temp1 & 0xff);

        for (let i = 0; i < 8; i++) {
            if (crc & 1) {
                crc = crc >> 1;
                crc ^= 0xA001;
            } else {
                crc = crc >> 1;
            }
        }

        return crc & 0xFFFF;
    }

    private computeCRC(buffer: Buffer): number {
        let crc = 0x0000;

        for (const val of buffer) {
            crc = this.calcCRC(crc, val);
        }

        crc = this.calcCRC(crc, 0x03);
        return crc;
    }

    private getNextTns(): number {
        const currentTns = this.tns;
        this.tns = (this.tns + 1) % 65536;
        return currentTns;
    }

    private parseAddress(address: string): [number, number, number] {
        const match = address.toUpperCase().match(/([A-Z])(\d+):(\d+)/);
        if (!match) {
            throw new Error(`Invalid address format: ${address}`);
        }

        const fileType = match[1];
        const fileNum = parseInt(match[2], 10);
        const element = parseInt(match[3], 10);

        if (!(fileType in DF1Protocol.FILE_TYPES)) {
            throw new Error(`Unknown file type: ${fileType}`);
        }

        return [DF1Protocol.FILE_TYPES[fileType], fileNum, element];
    }

    private createFrame(dst: number, src: number, cmd: number, tns: number, data: number[]): Buffer {
        const frame: number[] = [0x10, 0x02];
        const sts = 0x00;

        const frameData = [
            dst,
            src,
            cmd,
            sts,
            tns & 0xFF,
            (tns >> 8) & 0xFF,
            ...data
        ];

        const escapedData: number[] = [];
        for (const byte of frameData) {
            if (byte === 0x10) {
                escapedData.push(0x10, 0x10);
            } else {
                escapedData.push(byte);
            }
        }

        frame.push(...escapedData);

        const crc = this.computeCRC(Buffer.from(frameData));

        frame.push(0x10, 0x03);
        frame.push(crc & 0xFF, (crc >> 8) & 0xFF);

        return Buffer.from(frame);
    }

    private cleanDF1(): void {
        if (this.port.isOpen) {
            this.port.flush();
            this.port.drain();
            this.buffer = Buffer.alloc(0);
        }
        //this.pendingTransactions.clear();
    }

    private processFrame(buffer: Buffer): Buffer | null {

        try {
            if (buffer.length < 4 || buffer[0] !== 0x10 || buffer[1] !== 0x02) {

                this.cleanDF1();
                return null;
            }

            const frame: number[] = [];
            let i = 2;
            let dleFlag = false;

            while (i < buffer.length - 3) {
                const byte = buffer[i];

                if (byte === 0x10) {
                    if (dleFlag) {
                        frame.push(byte);
                        dleFlag = false;
                    } else {
                        dleFlag = true;
                    }
                } else {
                    if (dleFlag && byte === 0x03) {
                        break;
                    }
                    frame.push(byte);
                    dleFlag = false;
                }
                i++;
            }

            if (i >= buffer.length) {
                this.cleanDF1();
                return null;
            }

            //console.log('Processing frame:', buffer);

            const crcReceived = (buffer[i + 2] << 8) | buffer[i + 1];
            const crcCalculated = this.computeCRC(Buffer.from(frame));

            this.cleanDF1();

            console.log('CRC Received:', crcReceived.toString(16));
            console.log('CRC Calculated:', crcCalculated.toString(16));

            if (crcReceived !== crcCalculated) {
                this.port.write(Buffer.from([0x10, 0x15])); // NAK
                return null;
            }

            this.port.write(Buffer.from([0x10, 0x06])); // ACK
            return Buffer.from(frame);

        } catch (error) {
            console.error('Error processing frame:', error);
            this.pendingTransactions.clear();
            return null;
        }
    }

    private handleFrame(frame: Buffer): void {
        try {
            const tns = (frame[5] << 8) | frame[4];
            const transaction = this.pendingTransactions.get(tns);

            if (transaction) {
                clearTimeout(transaction.timer);
                this.pendingTransactions.delete(tns);
                transaction.resolve(frame);
            } else {
                console.warn(`TNS ${tns.toString(16)} not found`);
            }
        } catch (error) {
            console.error('Error in handleFrame:', error);
            this.pendingTransactions.clear();
            //this.tns = new Date().getSeconds() + 1;
            this.emit('error', error);
        }
    }

    private handleIncomingData(data: Buffer): void {
        this.buffer = data //Buffer.concat([this.buffer, data]);
        //console.log('Incoming data:', this.buffer);

        while (this.buffer.length > 0) {
            if (this.buffer[0] === 0x10 && this.buffer[1] === 0x06) {
                this.buffer = this.buffer.slice(2);
                continue;
            }

            if (this.buffer[0] === 0x10 && this.buffer[1] === 0x05) {
                this.buffer = this.buffer.slice(2);
                continue;
            }

            const frame = this.processFrame(this.buffer);
            if (frame) {
                this.handleFrame(frame);
                this.buffer = Buffer.alloc(0);
            } else {
                break;
            }
        }
    }

    public async start(): Promise<void> {
        if (!this.running) {
            this.running = true;
            this.connect();
        }
    }

    public async stop(): Promise<void> {
        this.running = false;
        this.disconnect();
    }

    public async readData(address: string, size: number): Promise<number[] | null> {
        if (!this.running) {
            throw new Error('DF1 protocol is not running');
        }

        try {
            const [fileType, fileNum, element] = this.parseAddress(address);
            const tns = this.getNextTns();

            const numBytes = address[0] === 'B' ? 2 : address[0] === 'N' ? 2 : address[0] === 'F' ? 4 : 0;

            const data = [
                0xa1,
                (size * numBytes) & 0xff,
                fileNum,
                fileType,
                element & 0xff
            ];

            const frame = this.createFrame(1, 0, DF1Protocol.CMD_READ, tns, data);

            try {
                const response = await new Promise<Buffer | null>((resolve, reject) => {

                    const timer = setTimeout(() => {
                        this.pendingTransactions.delete(tns);
                        //this.emit("error", new Error('Timeout waiting for response'));
                        reject(new Error('Timeout waiting for response'));
                    }, 1200);

                    try {
                        this.pendingTransactions.set(tns, { resolve, reject, timer });
                        this.port.write(frame);
                        //console.log('Sent frame:', frame);

                    } catch (error) {
                        clearTimeout(timer);
                        this.pendingTransactions.clear();                        
                        this.emit('error', error);
                        reject(error);

                    }finally{
                        clearTimeout(timer);
                    }


                });

                if (response) {
                    const responseData = Array.from(response.slice(6));
                    this.emit('data_ready', address, responseData);
                    return responseData;
                }

            } catch (error) {

                //this.pendingTransactions.clear();
                this.emit('error', error);
                return null;
            }

        } catch (error) {
            this.pendingTransactions.clear();
            //this.tns = new Date().getSeconds() + 1;
            this.emit('error', error);
        }

        return null;
    }

    public async writeData(address: string, values: number[]): Promise<boolean> {
        try {
            const [fileType, fileNum, element] = this.parseAddress(address);
            const tns = this.getNextTns();
            const numBytes = address[0] === 'B' ? 2 : address[0] === 'N' ? 2 : address[0] === 'F' ? 4 : 0;

            const data = [
                0xa1,
                values.length * numBytes & 0xff,
                fileNum,
                fileType,
                element & 0xff,
                ...values
            ];

            const frame = this.createFrame(1, 0, DF1Protocol.CMD_WRITE, tns, data);

            const response = await new Promise<Buffer | null>((resolve, reject) => {
                const timer = setTimeout(() => {
                    this.pendingTransactions.delete(tns);
                    reject(new Error('Timeout waiting for response'));
                }, 2000);

                this.pendingTransactions.set(tns, { resolve, reject, timer });
                this.port.write(frame);
            });

            return !!response;

        } catch (error) {
            this.emit('error', error);
            return false;
        }
    }
}
