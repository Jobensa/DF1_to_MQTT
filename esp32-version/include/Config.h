#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include <SPIFFS.h>

#define MAX_TAGS 10

struct TagConfig {
    char name[32];
    char address[16];
    uint8_t size;
    uint16_t pollRate;
    bool writeable;
};

struct DF1Config {
    char port[32];
    long baudRate;
};

struct MQTTConfig {
    char brokerUrl[128];
    uint16_t port;
    char clientId[64];
    char username[64];
    char password[64];
    char topicPrefix[64];
};

struct WiFiConfig {
    char ssid[64];
    char password[64];
};

struct GatewayConfig {
    WiFiConfig wifi;
    DF1Config df1;
    MQTTConfig mqtt;
    TagConfig tags[MAX_TAGS];
    uint8_t tagCount;
};

class ConfigManager {
public:
    ConfigManager();
    bool begin();
    bool load(const char* filename = "/config.json");
    bool save(const char* filename = "/config.json");

    GatewayConfig& getConfig() { return config; }

    void printConfig();

private:
    GatewayConfig config;
    bool parseJSON(const char* json);
    void setDefaults();
    void parseBrokerUrl(const char* url, char* host, uint16_t* port);
};

#endif // CONFIG_H
