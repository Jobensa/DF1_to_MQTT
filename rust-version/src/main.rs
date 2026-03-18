mod config;
mod df1_protocol;
mod mqtt_client;

use anyhow::{Context, Result};
use config::GatewayConfig;
use df1_protocol::DF1Protocol;
use mqtt_client::MqttClient;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Mutex;
use tokio::time::interval;
use tracing::{error, info, warn};

#[derive(Clone)]
struct TagData {
    name: String,
    value: serde_json::Value,
    has_data: bool,
}

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .with_target(false)
        .with_thread_ids(false)
        .init();

    info!("=================================");
    info!("DF1-MQTT Gateway (Rust version)");
    info!("=================================\n");

    // Load configuration
    let config_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "config/default.json".to_string());

    let config = GatewayConfig::load(&config_path)
        .with_context(|| format!("Failed to load configuration from {}", config_path))?;

    config.print_summary();

    // Initialize DF1 protocol
    let df1 = Arc::new(Mutex::new(
        DF1Protocol::new(&config.df1.port, config.df1.baud_rate)
            .await
            .context("Failed to initialize DF1 protocol")?,
    ));

    // Initialize MQTT client
    let (broker_host, broker_port) = config.mqtt.parse_broker_url();
    let mqtt = Arc::new(
        MqttClient::new(
            &broker_host,
            broker_port,
            &config.mqtt.client_id,
            config.mqtt.username.as_deref(),
            config.mqtt.password.as_deref(),
            &config.mqtt.topic_prefix,
        )
        .await
        .context("Failed to initialize MQTT client")?,
    );

    info!("Gateway initialized successfully\n");

    // Shared tag data cache
    let tag_data_cache: Arc<Mutex<HashMap<String, TagData>>> =
        Arc::new(Mutex::new(HashMap::new()));

    // Spawn a task for each tag to poll independently
    for tag_config in config.tags.clone() {
        let df1_clone = Arc::clone(&df1);
        let cache_clone = Arc::clone(&tag_data_cache);
        let tag_name = tag_config.name.clone();
        let tag_address = tag_config.address.clone();
        let tag_size = tag_config.size;
        let poll_rate = tag_config.poll_rate;

        tokio::spawn(async move {
            let mut interval = interval(Duration::from_millis(poll_rate));

            loop {
                interval.tick().await;

                // Read tag data
                let mut df1 = df1_clone.lock().await;
                match df1.read_data(&tag_address, tag_size).await {
                    Ok(data) => {
                        // Format the value based on address type
                        let value = format_tag_value(&tag_address, &data);

                        // Update cache
                        let mut cache = cache_clone.lock().await;
                        cache.insert(
                            tag_name.clone(),
                            TagData {
                                name: tag_name.clone(),
                                value,
                                has_data: true,
                            },
                        );
                    }
                    Err(e) => {
                        warn!("Failed to read tag {}: {}", tag_name, e);

                        // Mark as failed in cache
                        let mut cache = cache_clone.lock().await;
                        cache.insert(
                            tag_name.clone(),
                            TagData {
                                name: tag_name.clone(),
                                value: serde_json::json!({}),
                                has_data: false,
                            },
                        );
                    }
                }
            }
        });
    }

    // Publish task - collects and publishes all tag data every second
    let mqtt_clone = Arc::clone(&mqtt);
    let cache_clone = Arc::clone(&tag_data_cache);

    tokio::spawn(async move {
        let mut publish_interval = interval(Duration::from_secs(1));

        loop {
            publish_interval.tick().await;

            let mut cache = cache_clone.lock().await;

            if cache.is_empty() {
                // No data yet, publish fail message
                if let Err(e) = mqtt_clone
                    .publish_tag_data("unknown", "fail", serde_json::json!({}))
                    .await
                {
                    error!("Failed to publish MQTT message: {}", e);
                }
            } else {
                // Publish each tag
                for tag_data in cache.values() {
                    let status = if tag_data.has_data { "OK" } else { "fail" };

                    if let Err(e) = mqtt_clone
                        .publish_tag_data(&tag_data.name, status, tag_data.value.clone())
                        .await
                    {
                        error!("Failed to publish tag {}: {}", tag_data.name, e);
                    }
                }
            }

            // Clear cache after publishing
            cache.clear();
        }
    });

    info!("Gateway started, polling tags...\n");

    // Wait for Ctrl+C
    tokio::signal::ctrl_c()
        .await
        .context("Failed to listen for Ctrl+C")?;

    info!("\nShutting down gracefully...");
    Ok(())
}

fn format_tag_value(address: &str, data: &[u8]) -> serde_json::Value {
    let tag_type = address.chars().next().unwrap().to_uppercase().next().unwrap();

    match tag_type {
        'N' | 'B' => {
            // Integer (16-bit)
            let mut values = Vec::new();
            for chunk in data.chunks(2) {
                if chunk.len() == 2 {
                    let value = i16::from_le_bytes([chunk[0], chunk[1]]);
                    values.push(value);
                }
            }
            serde_json::json!(values)
        }
        'F' => {
            // Float (32-bit)
            let mut values = Vec::new();
            for chunk in data.chunks(4) {
                if chunk.len() == 4 {
                    let value = f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
                    values.push(value);
                }
            }
            serde_json::json!(values)
        }
        _ => {
            // Raw bytes
            serde_json::json!(data.iter().map(|&b| b as i32).collect::<Vec<_>>())
        }
    }
}
