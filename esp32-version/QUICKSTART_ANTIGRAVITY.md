# Guía Rápida - Antigravity IDE

Esta guía te ayudará a poner en marcha el proyecto rápidamente usando Antigravity IDE de Google.

## Paso 1: Abrir el Proyecto

1. Abre **Antigravity IDE**
2. `File` → `Open Folder`
3. Navega a la carpeta `esp32-version/`
4. Click en `Select Folder`

Antigravity detectará automáticamente que es un proyecto PlatformIO.

## Paso 2: Explorar la Interfaz de PlatformIO

Antigravity mostrará una barra inferior con iconos de PlatformIO:

```
[✓] Build    [→] Upload    [🗑️] Clean    [📡] Serial Monitor    [⚙️] Tasks
```

También puedes acceder a todas las funciones desde la **Paleta de Comandos**:
- Linux/Windows: `Ctrl + Shift + P`
- Mac: `Cmd + Shift + P`

Escribe "PlatformIO" para ver todas las opciones disponibles.

## Paso 3: Configurar tu WiFi y MQTT

1. Abre el archivo `data/config.json` en el explorador de archivos
2. Edita los siguientes campos:

```json
{
    "wifi": {
        "ssid": "TU_WIFI",              ← Cambia esto
        "password": "TU_PASSWORD"        ← Cambia esto
    },
    "mqtt": {
        "brokerUrl": "mqtt://192.168.1.100:1883",  ← Cambia la IP de tu broker
        "clientId": "df1-gateway-esp32",
        "username": "",                  ← Opcional: usuario MQTT
        "password": "",                  ← Opcional: password MQTT
        "topicPrefix": "plc/df1"
    }
}
```

3. Guarda el archivo (`Ctrl + S`)

## Paso 4: Seleccionar el Entorno

En la barra inferior de Antigravity, verás el entorno actual (por defecto: `esp32dev`).

Para cambiar el entorno:
1. Click en el nombre del entorno en la barra inferior
2. Selecciona:
   - `esp32dev` → Para ESP32 estándar
   - `esp32-s3` → Para ESP32-S3
   - `esp32-c3` → Para ESP32-C3

## Paso 5: Subir el Filesystem (Config)

**IMPORTANTE**: Debes hacer esto ANTES de subir el firmware.

### Método 1 - Paleta de Comandos (Recomendado):
1. `Ctrl + Shift + P`
2. Escribe: `PlatformIO: Upload Filesystem Image`
3. Espera a que termine (verás progreso en la terminal)

### Método 2 - Terminal Integrada:
1. `Terminal` → `New Terminal`
2. Ejecuta:
```bash
pio run --target uploadfs
```

Verás algo como:
```
Configuring upload protocol...
AVAILABLE: cmsis-dap, esp-bridge, esp-prog, espota, esptool, iot-bus-jtag, jlink, minimodule, olimex-arm-usb-ocd, olimex-arm-usb-ocd-h, olimex-arm-usb-tiny-h, olimex-jtag-tiny, tumpa
CURRENT: upload_protocol = esptool
Looking for upload port...
Auto-detected: /dev/ttyUSB0
Uploading SPIFFS image...
```

## Paso 6: Compilar y Subir el Firmware

### Método 1 - Botón de Upload (Más Fácil):
1. Conecta tu ESP32 por USB
2. Click en el botón **[→]** `Upload` en la barra inferior
3. Antigravity compilará automáticamente y subirá el firmware

### Método 2 - Paleta de Comandos:
1. `Ctrl + Shift + P`
2. Escribe: `PlatformIO: Upload`

### Método 3 - Terminal:
```bash
pio run --target upload
```

## Paso 7: Monitor Serial

Para ver los logs del ESP32:

### Método 1 - Icono Serial Monitor:
1. Click en el icono **[📡]** en la barra inferior
2. Verás la salida serial en tiempo real

### Método 2 - Paleta de Comandos:
1. `Ctrl + Shift + P`
2. Escribe: `PlatformIO: Serial Monitor`

### Método 3 - Terminal:
```bash
pio device monitor
```

Deberías ver algo como:
```
=================================
DF1-MQTT Gateway for ESP32
=================================

SPIFFS mounted successfully
Configuration loaded from /config.json

=== Gateway Configuration ===
WiFi SSID: TU_WIFI
DF1 Port: Serial2 @ 19200 baud
MQTT Broker: 192.168.1.100:1883
MQTT Client ID: df1-gateway-esp32
MQTT Topic Prefix: plc/df1
Tags configured: 6
============================

Connecting to WiFi: TU_WIFI
..........
WiFi connected
IP Address: 192.168.1.150
DF1 Protocol started successfully
MQTT: Connected

=== Gateway Started ===
```

## Atajos de Teclado Útiles en Antigravity

| Acción | Windows/Linux | Mac |
|--------|---------------|-----|
| Paleta de Comandos | `Ctrl+Shift+P` | `Cmd+Shift+P` |
| Build | `Ctrl+Alt+B` | `Cmd+Alt+B` |
| Upload | `Ctrl+Alt+U` | `Cmd+Alt+U` |
| Serial Monitor | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| Terminal | `` Ctrl+` `` | `` Cmd+` `` |
| Buscar Archivo | `Ctrl+P` | `Cmd+P` |

## Workflow Típico de Desarrollo

1. **Editar código** en `src/main.cpp` u otros archivos
2. **Build** → Click en `[✓]` o `Ctrl+Alt+B`
3. **Upload** → Click en `[→]` o `Ctrl+Alt+U`
4. **Monitor** → Click en `[📡]` para ver logs

## Solución de Problemas

### No detecta el puerto USB

1. Verifica que el cable USB sea de datos (no solo carga)
2. Instala drivers CH340/CP2102 según tu ESP32
3. En Linux, agrega tu usuario al grupo `dialout`:
```bash
sudo usermod -a -G dialout $USER
# Luego cierra sesión y vuelve a entrar
```

### Error: "Access Denied" al subir

En Linux:
```bash
sudo chmod 666 /dev/ttyUSB0
```

### No compila - "command not found: pio"

1. Abre la Terminal Integrada de Antigravity
2. Ejecuta:
```bash
which pio
```

Si no muestra nada, reinstala PlatformIO:
```bash
pip install -U platformio
```

### IntelliSense no funciona

1. `Ctrl+Shift+P`
2. `C/C++: Reset IntelliSense Database`
3. Espera unos segundos a que reindexe

## Tareas Avanzadas desde la Paleta

Presiona `Ctrl+Shift+P` y prueba:

- `PlatformIO: Build` - Compilar sin subir
- `PlatformIO: Clean` - Limpiar archivos compilados
- `PlatformIO: Test` - Ejecutar tests unitarios
- `PlatformIO: Device List` - Ver puertos seriales disponibles
- `PlatformIO: Update Libraries` - Actualizar dependencias
- `PlatformIO: Project Tasks` - Ver todas las tareas disponibles

## Siguiente Paso

Una vez que veas `=== Gateway Started ===` en el monitor serial, tu gateway está listo.

Verifica que:
1. Se conectó a WiFi ✓
2. Se conectó a MQTT ✓
3. Inició el protocolo DF1 ✓

Ahora conecta el PLC al ESP32 (GPIO16/17 con conversor RS-232) y deberías empezar a ver datos publicados en MQTT.

## Recursos Adicionales

- [Documentación PlatformIO](https://docs.platformio.org/)
- [ESP32 Pinout Reference](https://randomnerdtutorials.com/esp32-pinout-reference-gpios/)
- [MQTT Explorer](http://mqtt-explorer.com/) - Herramienta para visualizar mensajes MQTT
