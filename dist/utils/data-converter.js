"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DataConverter = void 0;
class DataConverter {
    static parseWriteValue(address, value) {
        const type = address[0].toUpperCase();
        switch (type) {
            case 'B':
                const binValue = parseInt(value);
                return [(binValue >> 8) & 0xFF, binValue & 0xFF];
            case 'N':
                const intValue = parseInt(value);
                return [(intValue >> 8) & 0xFF, intValue & 0xFF];
            case 'F':
                const floatValue = parseFloat(value);
                const buffer = Buffer.alloc(4);
                buffer.writeFloatLE(floatValue, 0);
                return Array.from(buffer);
            default:
                throw new Error(`Unsupported data type for writing: ${type}`);
        }
    }
    static formatReadValue(address, data) {
        const type = address[0].toUpperCase();
        switch (type) {
            case 'B':
                const bin16Data = new Int16Array(new Uint8Array(data).buffer);
                return Array.from(bin16Data).join(',');
            case 'N':
                const int16Data = new Int16Array(new Uint8Array(data).buffer);
                return Array.from(int16Data).join(',');
            case 'F':
                const float32Data = new Float32Array(new Uint8Array(data).buffer);
                return Array.from(float32Data).join(',');
            default:
                return data.join(',');
        }
    }
}
exports.DataConverter = DataConverter;
