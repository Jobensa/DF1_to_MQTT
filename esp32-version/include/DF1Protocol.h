#ifndef DF1PROTOCOL_H
#define DF1PROTOCOL_H

#include <Arduino.h>
#include <HardwareSerial.h>
#include <functional>

// File types for DF1 protocol
enum DF1FileType {
    OUTPUT = 0x8B,      // O
    INPUT = 0x8C,       // I
    STATUS = 0x84,      // S
    BIT = 0x85,         // B
    TIMER = 0x86,       // T
    COUNTER = 0x87,     // C
    CONTROL = 0x88,     // R
    INTEGER = 0x89,     // N
    FLOAT = 0x8A        // F
};

// Command codes
#define DF1_CMD_READ  0x0F
#define DF1_CMD_WRITE 0x0E

// Timeouts and retries
#define DF1_RESPONSE_TIMEOUT 1200
#define DF1_MAX_FRAME_SIZE 256

struct DF1Address {
    uint8_t fileType;
    uint8_t fileNum;
    uint8_t element;
    char type;  // 'N', 'F', 'B', etc.
};

struct PendingTransaction {
    uint16_t tns;
    unsigned long startTime;
    bool waiting;
    uint8_t* responseData;
    size_t responseLength;
};

class DF1Protocol {
public:
    DF1Protocol(HardwareSerial* serial, long baudRate = 19200);
    ~DF1Protocol();

    // Connection management
    bool begin();
    void end();
    bool isConnected();

    // Data operations
    bool readData(const char* address, uint8_t size, uint8_t* buffer, size_t* bufferLen);
    bool writeData(const char* address, uint8_t* values, size_t valueLen);

    // Process incoming data (call in loop())
    void process();

    // Callbacks
    typedef std::function<void(const char*, bool)> ConnectionCallback;
    typedef std::function<void(const char*)> ErrorCallback;

    void onConnection(ConnectionCallback cb) { connectionCallback = cb; }
    void onError(ErrorCallback cb) { errorCallback = cb; }

private:
    HardwareSerial* port;
    long baudRate;
    bool connected;

    uint16_t tns;  // Transaction number
    PendingTransaction pendingTx;

    uint8_t rxBuffer[DF1_MAX_FRAME_SIZE];
    size_t rxBufferPos;
    unsigned long lastRxTime;

    ConnectionCallback connectionCallback;
    ErrorCallback errorCallback;

    // Protocol methods
    bool parseAddress(const char* address, DF1Address* result);
    uint16_t computeCRC(const uint8_t* data, size_t len);
    uint16_t calcCRC(uint16_t crc, uint8_t value);
    uint16_t getNextTns();

    void createFrame(uint8_t dst, uint8_t src, uint8_t cmd, uint16_t tns,
                    const uint8_t* data, size_t dataLen, uint8_t* frame, size_t* frameLen);
    bool processFrame(const uint8_t* buffer, size_t len, uint8_t* frame, size_t* frameLen);
    void handleFrame(const uint8_t* frame, size_t frameLen);
    void cleanBuffer();

    void sendACK();
    void sendNAK();
};

#endif // DF1PROTOCOL_H
