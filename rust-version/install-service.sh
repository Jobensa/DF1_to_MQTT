#!/bin/bash
# Install DF1-MQTT Gateway as systemd service

set -e

if [ "$EUID" -ne 0 ]; then
    echo "Please run as root (use sudo)"
    exit 1
fi

echo "Installing DF1-MQTT Gateway service..."

# Create installation directory
INSTALL_DIR="/opt/df1-mqtt-gateway"
mkdir -p "$INSTALL_DIR"
mkdir -p "$INSTALL_DIR/config"
mkdir -p "$INSTALL_DIR/logs"

# Copy binary
echo "Copying binary..."
cp target/release/df1-mqtt-gateway "$INSTALL_DIR/"
chmod +x "$INSTALL_DIR/df1-mqtt-gateway"

# Copy config
echo "Copying configuration..."
if [ ! -f "$INSTALL_DIR/config/default.json" ]; then
    cp config/default.json "$INSTALL_DIR/config/"
else
    echo "Config already exists, skipping..."
fi

# Set permissions
chown -R pi:pi "$INSTALL_DIR"

# Add pi user to dialout group (for serial port access)
usermod -a -G dialout pi || true

# Install systemd service
echo "Installing systemd service..."
cp df1-mqtt-gateway.service /etc/systemd/system/
systemctl daemon-reload

echo ""
echo "Installation complete!"
echo ""
echo "To start the service:"
echo "  sudo systemctl start df1-mqtt-gateway"
echo ""
echo "To enable on boot:"
echo "  sudo systemctl enable df1-mqtt-gateway"
echo ""
echo "To view logs:"
echo "  sudo journalctl -u df1-mqtt-gateway -f"
echo ""
echo "To edit config:"
echo "  sudo nano $INSTALL_DIR/config/default.json"
echo "  sudo systemctl restart df1-mqtt-gateway"
