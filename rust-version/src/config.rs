use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TagConfig {
    pub name: String,
    pub address: String,
    pub size: u8,
    #[serde(rename = "pollRate")]
    pub poll_rate: u64, // milliseconds
    #[serde(default)]
    pub writeable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DF1Config {
    pub port: String,
    #[serde(rename = "baudRate")]
    pub baud_rate: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MQTTConfig {
    #[serde(rename = "brokerUrl")]
    pub broker_url: String,
    #[serde(rename = "clientId")]
    pub client_id: String,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(rename = "topicPrefix")]
    pub topic_prefix: String,
}

impl MQTTConfig {
    pub fn parse_broker_url(&self) -> (String, u16) {
        // Parse mqtt://host:port or just host:port
        let url = self.broker_url.trim();

        let host_port = if url.starts_with("mqtt://") {
            &url[7..]
        } else if url.starts_with("mqtts://") {
            &url[8..]
        } else {
            url
        };

        if let Some(colon_pos) = host_port.rfind(':') {
            let host = &host_port[..colon_pos];
            let port = host_port[colon_pos + 1..]
                .parse()
                .unwrap_or(1883);
            (host.to_string(), port)
        } else {
            (host_port.to_string(), 1883)
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayConfig {
    pub df1: DF1Config,
    pub mqtt: MQTTConfig,
    pub tags: Vec<TagConfig>,
}

impl GatewayConfig {
    pub fn load<P: AsRef<Path>>(path: P) -> Result<Self> {
        let path = path.as_ref();
        let contents = fs::read_to_string(path)
            .with_context(|| format!("Failed to read config file: {}", path.display()))?;

        let config: GatewayConfig = serde_json::from_str(&contents)
            .with_context(|| format!("Failed to parse config file: {}", path.display()))?;

        Ok(config)
    }

    pub fn save<P: AsRef<Path>>(&self, path: P) -> Result<()> {
        let path = path.as_ref();
        let contents = serde_json::to_string_pretty(self)
            .context("Failed to serialize configuration")?;

        fs::write(path, contents)
            .with_context(|| format!("Failed to write config file: {}", path.display()))?;

        Ok(())
    }

    pub fn print_summary(&self) {
        println!("\n=== Gateway Configuration ===");
        println!("DF1 Port: {} @ {} baud", self.df1.port, self.df1.baud_rate);
        println!("MQTT Broker: {}", self.mqtt.broker_url);
        println!("MQTT Client ID: {}", self.mqtt.client_id);
        println!("MQTT Topic Prefix: {}", self.mqtt.topic_prefix);
        println!("Tags configured: {}", self.tags.len());

        for (i, tag) in self.tags.iter().enumerate() {
            println!(
                "  [{}] {} ({}) - Size: {}, Poll: {}ms, Write: {}",
                i,
                tag.name,
                tag.address,
                tag.size,
                tag.poll_rate,
                if tag.writeable { "Yes" } else { "No" }
            );
        }
        println!("============================\n");
    }
}
