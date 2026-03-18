#!/bin/bash
# Build script for DF1-MQTT Gateway (Rust)

set -e

echo "Building DF1-MQTT Gateway (Rust)..."

# Build release binary
cargo build --release

echo ""
echo "Build complete!"
echo "Binary location: target/release/df1-mqtt-gateway"
echo ""
echo "To run:"
echo "  ./target/release/df1-mqtt-gateway [config-file]"
echo ""
echo "To install as systemd service:"
echo "  sudo ./install-service.sh"
