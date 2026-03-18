use anyhow::{Context, Result};
use rumqttc::{AsyncClient, Event, EventLoop, MqttOptions, Packet, QoS};
use serde_json::json;
use std::time::Duration;
use tokio::task::JoinHandle;
use tracing::{debug, error, info, warn};

pub struct MqttClient {
    client: AsyncClient,
    event_loop_handle: Option<JoinHandle<()>>,
    topic_prefix: String,
}

impl MqttClient {
    pub async fn new(
        broker_url: &str,
        port: u16,
        client_id: &str,
        username: Option<&str>,
        password: Option<&str>,
        topic_prefix: &str,
    ) -> Result<Self> {
        info!(
            "Connecting to MQTT broker: {}:{} as {}",
            broker_url, port, client_id
        );

        let mut mqtt_options = MqttOptions::new(client_id, broker_url, port);
        mqtt_options.set_keep_alive(Duration::from_secs(60));
        mqtt_options.set_connection_timeout(30);

        if let (Some(user), Some(pass)) = (username, password) {
            mqtt_options.set_credentials(user, pass);
        }

        let (client, mut eventloop) = AsyncClient::new(mqtt_options, 10);

        // Spawn event loop handler
        let handle = tokio::spawn(async move {
            loop {
                match eventloop.poll().await {
                    Ok(Event::Incoming(Packet::ConnAck(_))) => {
                        info!("MQTT connected successfully");
                    }
                    Ok(Event::Incoming(packet)) => {
                        debug!("MQTT incoming: {:?}", packet);
                    }
                    Ok(Event::Outgoing(_)) => {
                        // Outgoing packets
                    }
                    Err(e) => {
                        error!("MQTT connection error: {}", e);
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        });

        // Wait a bit for initial connection
        tokio::time::sleep(Duration::from_secs(1)).await;

        Ok(MqttClient {
            client,
            event_loop_handle: Some(handle),
            topic_prefix: topic_prefix.to_string(),
        })
    }

    pub async fn publish_tag_data(
        &self,
        tag_name: &str,
        status: &str,
        value: serde_json::Value,
    ) -> Result<()> {
        let topic = format!("{}/data/plc", self.topic_prefix);

        let message = json!({
            "tag": tag_name,
            "status": status,
            "value": value
        });

        let payload = serde_json::to_string(&message)
            .context("Failed to serialize MQTT message")?;

        self.client
            .publish(&topic, QoS::AtLeastOnce, false, payload)
            .await
            .context("Failed to publish MQTT message")?;

        debug!("Published to {}: tag={}, status={}", topic, tag_name, status);
        Ok(())
    }

    pub async fn subscribe(&self, topic: &str) -> Result<()> {
        self.client
            .subscribe(topic, QoS::AtLeastOnce)
            .await
            .context("Failed to subscribe to MQTT topic")?;

        info!("Subscribed to MQTT topic: {}", topic);
        Ok(())
    }
}

impl Drop for MqttClient {
    fn drop(&mut self) {
        if let Some(handle) = self.event_loop_handle.take() {
            handle.abort();
        }
    }
}
