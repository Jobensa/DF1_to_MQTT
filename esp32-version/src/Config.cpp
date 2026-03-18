#include "Config.h"

ConfigManager::ConfigManager() {
    setDefaults();
}

bool ConfigManager::begin() {
    if (!SPIFFS.begin(true)) {
        Serial.println("Failed to mount SPIFFS");
        return false;
    }
    Serial.println("SPIFFS mounted successfully");
    return true;
}

void ConfigManager::setDefaults() {
    // WiFi defaults
    strcpy(config.wifi.ssid, "YOUR_WIFI_SSID");
    strcpy(config.wifi.password, "YOUR_WIFI_PASSWORD");

    // DF1 defaults
    strcpy(config.df1.port, "Serial2");  // ESP32 Serial2
    config.df1.baudRate = 19200;

    // MQTT defaults
    strcpy(config.mqtt.brokerUrl, "mqtt://localhost:1883");
    config.mqtt.port = 1883;
    strcpy(config.mqtt.clientId, "df1-gateway-esp32");
    strcpy(config.mqtt.username, "");
    strcpy(config.mqtt.password, "");
    strcpy(config.mqtt.topicPrefix, "plc/df1");

    // Tags
    config.tagCount = 0;
}

void ConfigManager::parseBrokerUrl(const char* url, char* host, uint16_t* port) {
    // Parse mqtt://host:port or just host:port
    const char* hostStart = url;

    // Skip protocol if present
    if (strncmp(url, "mqtt://", 7) == 0) {
        hostStart = url + 7;
    } else if (strncmp(url, "mqtts://", 8) == 0) {
        hostStart = url + 8;
    }

    // Find port separator
    const char* portStart = strchr(hostStart, ':');
    if (portStart) {
        size_t hostLen = portStart - hostStart;
        strncpy(host, hostStart, hostLen);
        host[hostLen] = '\0';
        *port = atoi(portStart + 1);
    } else {
        strcpy(host, hostStart);
        *port = 1883;  // Default MQTT port
    }
}

bool ConfigManager::parseJSON(const char* json) {
    DynamicJsonDocument doc(4096);
    DeserializationError error = deserializeJson(doc, json);

    if (error) {
        Serial.printf("Failed to parse JSON: %s\n", error.c_str());
        return false;
    }

    // Parse WiFi config
    if (doc.containsKey("wifi")) {
        JsonObject wifi = doc["wifi"];
        if (wifi.containsKey("ssid")) {
            strncpy(config.wifi.ssid, wifi["ssid"], sizeof(config.wifi.ssid) - 1);
        }
        if (wifi.containsKey("password")) {
            strncpy(config.wifi.password, wifi["password"], sizeof(config.wifi.password) - 1);
        }
    }

    // Parse DF1 config
    if (doc.containsKey("df1")) {
        JsonObject df1 = doc["df1"];
        if (df1.containsKey("port")) {
            strncpy(config.df1.port, df1["port"], sizeof(config.df1.port) - 1);
        }
        if (df1.containsKey("baudRate")) {
            config.df1.baudRate = df1["baudRate"];
        }
    }

    // Parse MQTT config
    if (doc.containsKey("mqtt")) {
        JsonObject mqtt = doc["mqtt"];
        if (mqtt.containsKey("brokerUrl")) {
            const char* url = mqtt["brokerUrl"];
            strncpy(config.mqtt.brokerUrl, url, sizeof(config.mqtt.brokerUrl) - 1);

            // Parse broker URL to extract host and port
            char host[128];
            parseBrokerUrl(url, host, &config.mqtt.port);
            strncpy(config.mqtt.brokerUrl, host, sizeof(config.mqtt.brokerUrl) - 1);
        }
        if (mqtt.containsKey("clientId")) {
            strncpy(config.mqtt.clientId, mqtt["clientId"], sizeof(config.mqtt.clientId) - 1);
        }
        if (mqtt.containsKey("username")) {
            strncpy(config.mqtt.username, mqtt["username"], sizeof(config.mqtt.username) - 1);
        }
        if (mqtt.containsKey("password")) {
            strncpy(config.mqtt.password, mqtt["password"], sizeof(config.mqtt.password) - 1);
        }
        if (mqtt.containsKey("topicPrefix")) {
            strncpy(config.mqtt.topicPrefix, mqtt["topicPrefix"], sizeof(config.mqtt.topicPrefix) - 1);
        }
    }

    // Parse tags
    if (doc.containsKey("tags")) {
        JsonArray tags = doc["tags"].as<JsonArray>();
        config.tagCount = 0;

        for (JsonObject tag : tags) {
            if (config.tagCount >= MAX_TAGS) break;

            TagConfig& t = config.tags[config.tagCount];

            if (tag.containsKey("name")) {
                strncpy(t.name, tag["name"], sizeof(t.name) - 1);
            }
            if (tag.containsKey("address")) {
                strncpy(t.address, tag["address"], sizeof(t.address) - 1);
            }
            if (tag.containsKey("size")) {
                t.size = tag["size"];
            }
            if (tag.containsKey("pollRate")) {
                t.pollRate = tag["pollRate"];
            }
            if (tag.containsKey("writeable")) {
                t.writeable = tag["writeable"];
            } else {
                t.writeable = false;
            }

            config.tagCount++;
        }
    }

    return true;
}

bool ConfigManager::load(const char* filename) {
    if (!SPIFFS.exists(filename)) {
        Serial.printf("Config file not found: %s\n", filename);
        Serial.println("Using default configuration");
        return false;
    }

    File file = SPIFFS.open(filename, "r");
    if (!file) {
        Serial.printf("Failed to open config file: %s\n", filename);
        return false;
    }

    size_t size = file.size();
    char* buffer = (char*)malloc(size + 1);
    if (!buffer) {
        file.close();
        Serial.println("Failed to allocate memory for config");
        return false;
    }

    file.readBytes(buffer, size);
    buffer[size] = '\0';
    file.close();

    bool success = parseJSON(buffer);
    free(buffer);

    if (success) {
        Serial.printf("Configuration loaded from %s\n", filename);
    }

    return success;
}

bool ConfigManager::save(const char* filename) {
    DynamicJsonDocument doc(4096);

    // WiFi
    JsonObject wifi = doc.createNestedObject("wifi");
    wifi["ssid"] = config.wifi.ssid;
    wifi["password"] = config.wifi.password;

    // DF1
    JsonObject df1 = doc.createNestedObject("df1");
    df1["port"] = config.df1.port;
    df1["baudRate"] = config.df1.baudRate;

    // MQTT
    JsonObject mqtt = doc.createNestedObject("mqtt");
    char fullUrl[256];
    snprintf(fullUrl, sizeof(fullUrl), "mqtt://%s:%d", config.mqtt.brokerUrl, config.mqtt.port);
    mqtt["brokerUrl"] = fullUrl;
    mqtt["clientId"] = config.mqtt.clientId;
    mqtt["username"] = config.mqtt.username;
    mqtt["password"] = config.mqtt.password;
    mqtt["topicPrefix"] = config.mqtt.topicPrefix;

    // Tags
    JsonArray tags = doc.createNestedArray("tags");
    for (uint8_t i = 0; i < config.tagCount; i++) {
        JsonObject tag = tags.createNestedObject();
        tag["name"] = config.tags[i].name;
        tag["address"] = config.tags[i].address;
        tag["size"] = config.tags[i].size;
        tag["pollRate"] = config.tags[i].pollRate;
        tag["writeable"] = config.tags[i].writeable;
    }

    File file = SPIFFS.open(filename, "w");
    if (!file) {
        Serial.printf("Failed to open file for writing: %s\n", filename);
        return false;
    }

    if (serializeJson(doc, file) == 0) {
        Serial.println("Failed to write to file");
        file.close();
        return false;
    }

    file.close();
    Serial.printf("Configuration saved to %s\n", filename);
    return true;
}

void ConfigManager::printConfig() {
    Serial.println("\n=== Gateway Configuration ===");
    Serial.printf("WiFi SSID: %s\n", config.wifi.ssid);
    Serial.printf("DF1 Port: %s @ %ld baud\n", config.df1.port, config.df1.baudRate);
    Serial.printf("MQTT Broker: %s:%d\n", config.mqtt.brokerUrl, config.mqtt.port);
    Serial.printf("MQTT Client ID: %s\n", config.mqtt.clientId);
    Serial.printf("MQTT Topic Prefix: %s\n", config.mqtt.topicPrefix);
    Serial.printf("Tags configured: %d\n", config.tagCount);

    for (uint8_t i = 0; i < config.tagCount; i++) {
        Serial.printf("  [%d] %s (%s) - Size:%d, Poll:%dms, Write:%s\n",
                     i, config.tags[i].name, config.tags[i].address,
                     config.tags[i].size, config.tags[i].pollRate,
                     config.tags[i].writeable ? "Yes" : "No");
    }
    Serial.println("============================\n");
}
