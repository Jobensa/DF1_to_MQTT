#ifndef MQTTMANAGER_H
#define MQTTMANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <functional>

#define MQTT_MAX_RECONNECT_DELAY 10000
#define MQTT_RECONNECT_DELAY 5000

class MQTTManager {
public:
    MQTTManager();
    ~MQTTManager();

    // Configuration
    void configure(const char* broker, uint16_t port, const char* clientId,
                  const char* username = nullptr, const char* password = nullptr,
                  const char* topicPrefix = "plc/df1");

    // Connection management
    bool connect();
    void disconnect();
    bool isConnected();
    void loop();

    // Publishing
    bool publishTagData(const char* tagName, const char* status, const char* value);
    bool publishJSON(const char* topic, const char* json);

    // Callbacks
    typedef std::function<void(char*, uint8_t*, unsigned int)> MessageCallback;
    typedef std::function<void(bool)> ConnectionCallback;

    void onMessage(MessageCallback cb) { messageCallback = cb; }
    void onConnection(ConnectionCallback cb) { connectionCallback = cb; }

private:
    WiFiClient wifiClient;
    PubSubClient* mqttClient;

    char broker[128];
    uint16_t port;
    char clientId[64];
    char username[64];
    char password[64];
    char topicPrefix[64];

    bool hasCredentials;
    unsigned long lastReconnectAttempt;

    MessageCallback messageCallback;
    ConnectionCallback connectionCallback;

    void mqttCallback(char* topic, uint8_t* payload, unsigned int length);
    bool reconnect();
};

#endif // MQTTMANAGER_H
