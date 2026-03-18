#include <Arduino.h>
#include <WiFi.h>
#include "Config.h"
#include "DF1Protocol.h"
#include "MQTTManager.h"

// Global objects
ConfigManager configManager;
DF1Protocol* df1 = nullptr;
MQTTManager mqttManager;

// Tag data cache
struct TagData {
    char name[32];
    char value[256];
    bool hasData;
    unsigned long lastUpdate;
};

TagData tagDataCache[MAX_TAGS];
unsigned long tagPollTimers[MAX_TAGS];

// Function prototypes
void setupWiFi();
void setupDF1();
void setupMQTT();
void pollTags();
void publishTagData();
void formatTagValue(const char* address, uint8_t* data, size_t len, char* output, size_t outputSize);

void setup() {
    Serial.begin(115200);
    delay(1000);

    Serial.println("\n\n=================================");
    Serial.println("DF1-MQTT Gateway for ESP32");
    Serial.println("=================================\n");

    // Initialize configuration
    if (!configManager.begin()) {
        Serial.println("FATAL: Failed to initialize filesystem");
        while (1) delay(1000);
    }

    // Load configuration
    if (!configManager.load("/config.json")) {
        Serial.println("WARNING: Using default configuration");
        // You may want to save defaults here
        // configManager.save("/config.json");
    }

    configManager.printConfig();

    // Initialize tag data cache
    for (int i = 0; i < MAX_TAGS; i++) {
        tagDataCache[i].hasData = false;
        tagDataCache[i].lastUpdate = 0;
        tagPollTimers[i] = 0;
    }

    // Setup components
    setupWiFi();
    setupDF1();
    setupMQTT();

    Serial.println("\n=== Gateway Started ===\n");
}

void loop() {
    // Process DF1 communications
    if (df1 && df1->isConnected()) {
        df1->process();
        pollTags();
    }

    // Process MQTT
    mqttManager.loop();

    // Publish cached tag data every second
    static unsigned long lastPublish = 0;
    if (millis() - lastPublish >= 1000) {
        lastPublish = millis();
        publishTagData();
    }

    delay(1);
}

void setupWiFi() {
    GatewayConfig& config = configManager.getConfig();

    Serial.printf("Connecting to WiFi: %s\n", config.wifi.ssid);

    WiFi.mode(WIFI_STA);
    WiFi.begin(config.wifi.ssid, config.wifi.password);

    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\nWiFi connected");
        Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
    } else {
        Serial.println("\nWiFi connection failed!");
    }
}

void setupDF1() {
    GatewayConfig& config = configManager.getConfig();

    // ESP32 has multiple hardware serial ports
    // Serial0 (USB), Serial1 (GPIO9/10), Serial2 (GPIO16/17)
    HardwareSerial* serial = &Serial2;  // Use Serial2 by default

    df1 = new DF1Protocol(serial, config.df1.baudRate);

    // Set callbacks
    df1->onConnection([](const char* msg, bool connected) {
        Serial.printf("DF1 Connection: %s (%s)\n", msg, connected ? "OK" : "FAIL");
    });

    df1->onError([](const char* error) {
        Serial.printf("DF1 Error: %s\n", error);
    });

    // Start DF1 protocol
    if (df1->begin()) {
        Serial.println("DF1 Protocol initialized");
    } else {
        Serial.println("Failed to initialize DF1 Protocol");
    }
}

void setupMQTT() {
    GatewayConfig& config = configManager.getConfig();

    // Configure MQTT
    const char* username = strlen(config.mqtt.username) > 0 ? config.mqtt.username : nullptr;
    const char* password = strlen(config.mqtt.password) > 0 ? config.mqtt.password : nullptr;

    mqttManager.configure(
        config.mqtt.brokerUrl,
        config.mqtt.port,
        config.mqtt.clientId,
        username,
        password,
        config.mqtt.topicPrefix
    );

    // Set callbacks
    mqttManager.onConnection([](bool connected) {
        Serial.printf("MQTT: %s\n", connected ? "Connected" : "Disconnected");
    });

    mqttManager.onMessage([](char* topic, uint8_t* payload, unsigned int length) {
        Serial.printf("MQTT Message [%s]: ", topic);
        for (unsigned int i = 0; i < length; i++) {
            Serial.print((char)payload[i]);
        }
        Serial.println();
        // TODO: Handle write requests from MQTT
    });

    // Connect to MQTT
    mqttManager.connect();
}

void pollTags() {
    GatewayConfig& config = configManager.getConfig();
    unsigned long now = millis();

    for (uint8_t i = 0; i < config.tagCount; i++) {
        TagConfig& tag = config.tags[i];

        // Check if it's time to poll this tag
        if (now - tagPollTimers[i] >= tag.pollRate) {
            tagPollTimers[i] = now;

            // Read tag data
            uint8_t buffer[256];
            size_t bufferLen = sizeof(buffer);

            if (df1->readData(tag.address, tag.size, buffer, &bufferLen)) {
                // Format value based on data type
                formatTagValue(tag.address, buffer, bufferLen,
                              tagDataCache[i].value, sizeof(tagDataCache[i].value));

                strcpy(tagDataCache[i].name, tag.name);
                tagDataCache[i].hasData = true;
                tagDataCache[i].lastUpdate = now;

                // Debug output
                // Serial.printf("Tag %s: %s\n", tag.name, tagDataCache[i].value);
            } else {
                // Mark as failed
                tagDataCache[i].hasData = false;
            }
        }
    }
}

void publishTagData() {
    GatewayConfig& config = configManager.getConfig();
    bool hasAnyData = false;

    for (uint8_t i = 0; i < config.tagCount; i++) {
        if (tagDataCache[i].hasData) {
            hasAnyData = true;
            mqttManager.publishTagData(
                tagDataCache[i].name,
                "OK",
                tagDataCache[i].value
            );
        }
    }

    // If no data, publish error
    if (!hasAnyData && config.tagCount > 0) {
        mqttManager.publishTagData("unknown", "fail", "{}");
    }
}

void formatTagValue(const char* address, uint8_t* data, size_t len, char* output, size_t outputSize) {
    char type = toupper(address[0]);
    output[0] = '\0';

    switch (type) {
        case 'N': // Integer (16-bit)
        case 'B': { // Bit (16-bit)
            size_t pos = 0;
            pos += snprintf(output + pos, outputSize - pos, "[");
            for (size_t i = 0; i < len; i += 2) {
                if (i + 1 < len) {
                    int16_t value = (int16_t)((data[i + 1] << 8) | data[i]);
                    pos += snprintf(output + pos, outputSize - pos, "%d", value);
                    if (i + 2 < len) {
                        pos += snprintf(output + pos, outputSize - pos, ",");
                    }
                }
            }
            snprintf(output + pos, outputSize - pos, "]");
            break;
        }

        case 'F': { // Float (32-bit)
            size_t pos = 0;
            pos += snprintf(output + pos, outputSize - pos, "[");
            for (size_t i = 0; i < len; i += 4) {
                if (i + 3 < len) {
                    float value;
                    memcpy(&value, data + i, 4);
                    pos += snprintf(output + pos, outputSize - pos, "%.2f", value);
                    if (i + 4 < len) {
                        pos += snprintf(output + pos, outputSize - pos, ",");
                    }
                }
            }
            snprintf(output + pos, outputSize - pos, "]");
            break;
        }

        default: {
            // Raw bytes
            size_t pos = 0;
            pos += snprintf(output + pos, outputSize - pos, "[");
            for (size_t i = 0; i < len && i < 64; i++) {
                pos += snprintf(output + pos, outputSize - pos, "%d", data[i]);
                if (i + 1 < len) {
                    pos += snprintf(output + pos, outputSize - pos, ",");
                }
            }
            snprintf(output + pos, outputSize - pos, "]");
            break;
        }
    }
}
