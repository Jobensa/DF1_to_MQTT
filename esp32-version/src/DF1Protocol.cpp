#include "DF1Protocol.h"

DF1Protocol::DF1Protocol(HardwareSerial* serial, long baud)
    : port(serial), baudRate(baud), connected(false), tns(1), rxBufferPos(0), lastRxTime(0) {
    pendingTx.waiting = false;
    pendingTx.responseData = nullptr;
    pendingTx.responseLength = 0;
}

DF1Protocol::~DF1Protocol() {
    end();
    if (pendingTx.responseData) {
        free(pendingTx.responseData);
    }
}

bool DF1Protocol::begin() {
    port->begin(baudRate, SERIAL_8N1);
    delay(100);

    if (port) {
        connected = true;
        Serial.println("DF1 Protocol started successfully");
        if (connectionCallback) {
            connectionCallback("Connected", true);
        }
        return true;
    }

    Serial.println("Failed to start DF1 Protocol");
    return false;
}

void DF1Protocol::end() {
    if (connected) {
        port->end();
        connected = false;
        if (connectionCallback) {
            connectionCallback("Disconnected", false);
        }
    }
}

bool DF1Protocol::isConnected() {
    return connected;
}

uint16_t DF1Protocol::getNextTns() {
    uint16_t current = tns;
    tns = (tns + 1) % 65536;
    return current;
}

uint16_t DF1Protocol::calcCRC(uint16_t crc, uint8_t value) {
    uint16_t temp = crc ^ value;
    crc = (crc & 0xFF00) | (temp & 0xFF);

    for (int i = 0; i < 8; i++) {
        if (crc & 1) {
            crc = crc >> 1;
            crc ^= 0xA001;
        } else {
            crc = crc >> 1;
        }
    }

    return crc & 0xFFFF;
}

uint16_t DF1Protocol::computeCRC(const uint8_t* data, size_t len) {
    uint16_t crc = 0x0000;

    for (size_t i = 0; i < len; i++) {
        crc = calcCRC(crc, data[i]);
    }

    crc = calcCRC(crc, 0x03);
    return crc;
}

bool DF1Protocol::parseAddress(const char* address, DF1Address* result) {
    // Parse format like "N7:0", "F8:0", "B3:0"
    if (!address || strlen(address) < 3) return false;

    result->type = toupper(address[0]);

    // Map file type
    switch (result->type) {
        case 'O': result->fileType = OUTPUT; break;
        case 'I': result->fileType = INPUT; break;
        case 'S': result->fileType = STATUS; break;
        case 'B': result->fileType = BIT; break;
        case 'T': result->fileType = TIMER; break;
        case 'C': result->fileType = COUNTER; break;
        case 'R': result->fileType = CONTROL; break;
        case 'N': result->fileType = INTEGER; break;
        case 'F': result->fileType = FLOAT; break;
        default: return false;
    }

    // Parse file number and element
    const char* colonPos = strchr(address, ':');
    if (!colonPos) return false;

    result->fileNum = atoi(address + 1);
    result->element = atoi(colonPos + 1);

    return true;
}

void DF1Protocol::createFrame(uint8_t dst, uint8_t src, uint8_t cmd, uint16_t tns,
                               const uint8_t* data, size_t dataLen, uint8_t* frame, size_t* frameLen) {
    size_t pos = 0;

    // Start delimiter
    frame[pos++] = 0x10;
    frame[pos++] = 0x02;

    // Build unescaped frame data
    uint8_t frameData[128];
    size_t fdPos = 0;

    frameData[fdPos++] = dst;
    frameData[fdPos++] = src;
    frameData[fdPos++] = cmd;
    frameData[fdPos++] = 0x00;  // STS
    frameData[fdPos++] = tns & 0xFF;
    frameData[fdPos++] = (tns >> 8) & 0xFF;

    // Add data
    for (size_t i = 0; i < dataLen; i++) {
        frameData[fdPos++] = data[i];
    }

    // Escape DLE characters
    for (size_t i = 0; i < fdPos; i++) {
        if (frameData[i] == 0x10) {
            frame[pos++] = 0x10;
            frame[pos++] = 0x10;
        } else {
            frame[pos++] = frameData[i];
        }
    }

    // End delimiter
    frame[pos++] = 0x10;
    frame[pos++] = 0x03;

    // CRC
    uint16_t crc = computeCRC(frameData, fdPos);
    frame[pos++] = crc & 0xFF;
    frame[pos++] = (crc >> 8) & 0xFF;

    *frameLen = pos;
}

void DF1Protocol::sendACK() {
    uint8_t ack[] = {0x10, 0x06};
    port->write(ack, 2);
}

void DF1Protocol::sendNAK() {
    uint8_t nak[] = {0x10, 0x15};
    port->write(nak, 2);
}

void DF1Protocol::cleanBuffer() {
    while (port->available()) {
        port->read();
    }
    rxBufferPos = 0;
}

bool DF1Protocol::processFrame(const uint8_t* buffer, size_t len, uint8_t* frame, size_t* frameLen) {
    if (len < 4 || buffer[0] != 0x10 || buffer[1] != 0x02) {
        return false;
    }

    // Unescape frame
    size_t pos = 2;
    size_t fPos = 0;
    bool dleFlag = false;

    while (pos < len - 3) {
        uint8_t byte = buffer[pos];

        if (byte == 0x10) {
            if (dleFlag) {
                frame[fPos++] = byte;
                dleFlag = false;
            } else {
                dleFlag = true;
            }
        } else {
            if (dleFlag && byte == 0x03) {
                break;
            }
            frame[fPos++] = byte;
            dleFlag = false;
        }
        pos++;
    }

    if (pos >= len) {
        return false;
    }

    // Verify CRC
    uint16_t crcReceived = (buffer[pos + 2] << 8) | buffer[pos + 1];
    uint16_t crcCalculated = computeCRC(frame, fPos);

    if (crcReceived != crcCalculated) {
        Serial.printf("CRC mismatch: received=%04X, calculated=%04X\n", crcReceived, crcCalculated);
        sendNAK();
        return false;
    }

    sendACK();
    *frameLen = fPos;
    return true;
}

void DF1Protocol::handleFrame(const uint8_t* frame, size_t frameLen) {
    if (frameLen < 6) return;

    uint16_t rxTns = (frame[5] << 8) | frame[4];

    if (pendingTx.waiting && pendingTx.tns == rxTns) {
        // Store response data
        size_t dataLen = frameLen - 6;
        if (dataLen > 0) {
            if (pendingTx.responseData) {
                free(pendingTx.responseData);
            }
            pendingTx.responseData = (uint8_t*)malloc(dataLen);
            if (pendingTx.responseData) {
                memcpy(pendingTx.responseData, frame + 6, dataLen);
                pendingTx.responseLength = dataLen;
            }
        }
        pendingTx.waiting = false;
    }
}

void DF1Protocol::process() {
    if (!connected) return;

    // Read incoming data
    while (port->available() && rxBufferPos < DF1_MAX_FRAME_SIZE) {
        rxBuffer[rxBufferPos++] = port->read();
        lastRxTime = millis();
    }

    // Process complete frames after 100ms of no data
    if (rxBufferPos > 0 && (millis() - lastRxTime) > 100) {
        // Check for ACK/ENQ
        if (rxBufferPos >= 2 && rxBuffer[0] == 0x10) {
            if (rxBuffer[1] == 0x06 || rxBuffer[1] == 0x05) {
                rxBufferPos = 0;
                return;
            }
        }

        // Process data frame
        uint8_t frame[DF1_MAX_FRAME_SIZE];
        size_t frameLen = 0;

        if (processFrame(rxBuffer, rxBufferPos, frame, &frameLen)) {
            handleFrame(frame, frameLen);
        }

        rxBufferPos = 0;
    }

    // Check for transaction timeout
    if (pendingTx.waiting && (millis() - pendingTx.startTime) > DF1_RESPONSE_TIMEOUT) {
        Serial.println("Transaction timeout");
        pendingTx.waiting = false;
        if (errorCallback) {
            errorCallback("Transaction timeout");
        }
    }
}

bool DF1Protocol::readData(const char* address, uint8_t size, uint8_t* buffer, size_t* bufferLen) {
    if (!connected) return false;

    DF1Address addr;
    if (!parseAddress(address, &addr)) {
        Serial.printf("Invalid address: %s\n", address);
        return false;
    }

    // Determine bytes per element
    uint8_t numBytes = (addr.type == 'B' || addr.type == 'N') ? 2 : (addr.type == 'F') ? 4 : 0;
    if (numBytes == 0) return false;

    // Build request data
    uint8_t data[5];
    data[0] = 0xA1;  // Protected typed logical read
    data[1] = (size * numBytes) & 0xFF;
    data[2] = addr.fileNum;
    data[3] = addr.fileType;
    data[4] = addr.element & 0xFF;

    // Create frame
    uint8_t frame[DF1_MAX_FRAME_SIZE];
    size_t frameLen = 0;
    uint16_t txTns = getNextTns();

    createFrame(1, 0, DF1_CMD_READ, txTns, data, 5, frame, &frameLen);

    // Set up pending transaction
    pendingTx.tns = txTns;
    pendingTx.startTime = millis();
    pendingTx.waiting = true;
    if (pendingTx.responseData) {
        free(pendingTx.responseData);
        pendingTx.responseData = nullptr;
    }
    pendingTx.responseLength = 0;

    // Send frame
    port->write(frame, frameLen);

    // Wait for response
    unsigned long start = millis();
    while (pendingTx.waiting && (millis() - start) < DF1_RESPONSE_TIMEOUT) {
        process();
        delay(1);
    }

    if (!pendingTx.waiting && pendingTx.responseData) {
        // Copy response data
        size_t copyLen = min(*bufferLen, pendingTx.responseLength);
        memcpy(buffer, pendingTx.responseData, copyLen);
        *bufferLen = copyLen;
        return true;
    }

    return false;
}

bool DF1Protocol::writeData(const char* address, uint8_t* values, size_t valueLen) {
    if (!connected) return false;

    DF1Address addr;
    if (!parseAddress(address, &addr)) {
        Serial.printf("Invalid address: %s\n", address);
        return false;
    }

    // Determine bytes per element
    uint8_t numBytes = (addr.type == 'B' || addr.type == 'N') ? 2 : (addr.type == 'F') ? 4 : 0;
    if (numBytes == 0) return false;

    // Build request data
    uint8_t data[128];
    data[0] = 0xA1;  // Protected typed logical write
    data[1] = valueLen & 0xFF;
    data[2] = addr.fileNum;
    data[3] = addr.fileType;
    data[4] = addr.element & 0xFF;

    // Add values
    memcpy(data + 5, values, valueLen);

    // Create frame
    uint8_t frame[DF1_MAX_FRAME_SIZE];
    size_t frameLen = 0;
    uint16_t txTns = getNextTns();

    createFrame(1, 0, DF1_CMD_WRITE, txTns, data, 5 + valueLen, frame, &frameLen);

    // Set up pending transaction
    pendingTx.tns = txTns;
    pendingTx.startTime = millis();
    pendingTx.waiting = true;

    // Send frame
    port->write(frame, frameLen);

    // Wait for response
    unsigned long start = millis();
    while (pendingTx.waiting && (millis() - start) < (DF1_RESPONSE_TIMEOUT * 2)) {
        process();
        delay(1);
    }

    return !pendingTx.waiting;
}
