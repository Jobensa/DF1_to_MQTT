#include "MQTTManager.h"

MQTTManager::MQTTManager()
    : port(1883), hasCredentials(false), lastReconnectAttempt(0) {
    mqttClient = new PubSubClient(wifiClient);
    memset(broker, 0, sizeof(broker));
    memset(clientId, 0, sizeof(clientId));
    memset(username, 0, sizeof(username));
    memset(password, 0, sizeof(password));
    memset(topicPrefix, 0, sizeof(topicPrefix));
}

MQTTManager::~MQTTManager() {
    if (mqttClient) {
        delete mqttClient;
    }
}

void MQTTManager::configure(const char* brokerAddr, uint16_t brokerPort, const char* id,
                            const char* user, const char* pass, const char* prefix) {
    strncpy(broker, brokerAddr, sizeof(broker) - 1);
    port = brokerPort;
    strncpy(clientId, id, sizeof(clientId) - 1);
    strncpy(topicPrefix, prefix, sizeof(topicPrefix) - 1);

    if (user && pass) {
        strncpy(username, user, sizeof(username) - 1);
        strncpy(password, pass, sizeof(password) - 1);
        hasCredentials = true;
    } else {
        hasCredentials = false;
    }

    mqttClient->setServer(broker, port);
    mqttClient->setKeepAlive(60);
    mqttClient->setSocketTimeout(30);

    // Set callback wrapper
    mqttClient->setCallback([this](char* topic, uint8_t* payload, unsigned int length) {
        this->mqttCallback(topic, payload, length);
    });

    Serial.printf("MQTT configured: %s:%d, client: %s\n", broker, port, clientId);
}

void MQTTManager::mqttCallback(char* topic, uint8_t* payload, unsigned int length) {
    if (messageCallback) {
        messageCallback(topic, payload, length);
    }
}

bool MQTTManager::reconnect() {
    if (millis() - lastReconnectAttempt < MQTT_RECONNECT_DELAY) {
        return false;
    }

    lastReconnectAttempt = millis();
    Serial.println("Attempting MQTT connection...");

    bool connected = false;
    if (hasCredentials) {
        connected = mqttClient->connect(clientId, username, password);
    } else {
        connected = mqttClient->connect(clientId);
    }

    if (connected) {
        Serial.println("MQTT connected");
        if (connectionCallback) {
            connectionCallback(true);
        }
    } else {
        Serial.printf("MQTT connection failed, rc=%d\n", mqttClient->state());
        if (connectionCallback) {
            connectionCallback(false);
        }
    }

    return connected;
}

bool MQTTManager::connect() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println("WiFi not connected");
        return false;
    }

    return reconnect();
}

void MQTTManager::disconnect() {
    if (mqttClient->connected()) {
        mqttClient->disconnect();
        Serial.println("MQTT disconnected");
    }
}

bool MQTTManager::isConnected() {
    return mqttClient->connected();
}

void MQTTManager::loop() {
    if (!mqttClient->connected()) {
        reconnect();
    } else {
        mqttClient->loop();
    }
}

bool MQTTManager::publishTagData(const char* tagName, const char* status, const char* value) {
    if (!mqttClient->connected()) {
        return false;
    }

    // Build JSON message
    char json[512];
    snprintf(json, sizeof(json),
             "{\"tag\":\"%s\",\"status\":\"%s\",\"value\":%s}",
             tagName, status, value);

    // Build topic
    char topic[128];
    snprintf(topic, sizeof(topic), "%s/data/plc", topicPrefix);

    return mqttClient->publish(topic, json, false);
}

bool MQTTManager::publishJSON(const char* topic, const char* json) {
    if (!mqttClient->connected()) {
        return false;
    }

    return mqttClient->publish(topic, json, false);
}
