# DF1-MQTT Gateway - ESP32 Version

Implementación en C++ para ESP32 del gateway DF1 a MQTT, convertido desde la versión original en Node.js/TypeScript.

## Características

- Comunicación DF1 con PLCs Allen-Bradley vía puerto serial
- Publicación de datos en broker MQTT vía WiFi
- Lectura/escritura de tipos de datos: Integer (N), Float (F), Bit (B)
- Configuración mediante archivo JSON en SPIFFS
- Soporte para múltiples tags con diferentes intervalos de polling
- Reconexión automática WiFi y MQTT
- Compatible con ESP32, ESP32-S3 y ESP32-C3

## Hardware Requerido

- ESP32 / ESP32-S3 / ESP32-C3
- Conversor RS-232/TTL (MAX3232 o similar) para conexión con PLC
- Cables para conexión serial

## Conexiones Hardware

### ESP32 (usando Serial2)

| ESP32 Pin | Conexión    | Descripción          |
|-----------|-------------|----------------------|
| GPIO16    | RX2         | Recepción serial DF1 |
| GPIO17    | TX2         | Transmisión serial DF1|
| GND       | GND         | Tierra común         |

**IMPORTANTE:** La mayoría de PLCs Allen-Bradley usan RS-232, que opera a voltajes de ±12V. Necesitas un conversor de niveles (MAX3232) entre el ESP32 (3.3V) y el PLC.

## Instalación y Configuración

### 1. Abrir Proyecto en Antigravity IDE

Este proyecto está configurado para trabajar con **Antigravity IDE de Google** con PlatformIO.

```bash
# Abre Antigravity IDE
# File -> Open Folder -> Selecciona la carpeta esp32-version/
```

La primera vez que abras el proyecto, Antigravity detectará automáticamente el archivo `platformio.ini` y configurará el entorno.

### 2. Inicializar PlatformIO (primera vez)

```bash
# Desde la terminal integrada de Antigravity:
cd esp32-version
pio project init --ide vscode
```

Esto generará los archivos `.vscode/` necesarios para IntelliSense y autocompletado.

### 3. Configurar WiFi y MQTT

Edita el archivo `data/config.json`:

```json
{
    "wifi": {
        "ssid": "TuWiFi",
        "password": "TuPassword"
    },
    "mqtt": {
        "brokerUrl": "mqtt://192.168.1.100:1883",
        "clientId": "df1-gateway-esp32",
        "username": "",
        "password": "",
        "topicPrefix": "plc/df1"
    },
    "df1": {
        "port": "Serial2",
        "baudRate": 19200
    },
    "tags": [
        {
            "name": "N7_0",
            "address": "N7:0",
            "size": 10,
            "pollRate": 1000,
            "writeable": true
        }
    ]
}
```

### 4. Subir el Sistema de Archivos (SPIFFS)

El archivo de configuración debe cargarse en la memoria flash del ESP32:

**Opción A - Desde Antigravity IDE:**
1. Abre la paleta de comandos: `Ctrl+Shift+P` (Linux/Windows) o `Cmd+Shift+P` (Mac)
2. Escribe: `PlatformIO: Upload Filesystem Image`
3. Selecciona el entorno (esp32dev, esp32-s3, etc.)

**Opción B - Desde Terminal:**
```bash
pio run --target uploadfs -e esp32dev
```

### 5. Compilar y Subir el Firmware

**Opción A - Desde Antigravity IDE:**
1. Abre la paleta de comandos: `Ctrl+Shift+P`
2. Escribe: `PlatformIO: Upload`
3. O usa el botón "Upload" en la barra inferior de Antigravity

**Opción B - Desde Terminal:**
```bash
# Para ESP32 estándar
pio run --target upload -e esp32dev

# Para ESP32-S3
pio run --target upload -e esp32-s3

# Para ESP32-C3
pio run --target upload -e esp32-c3
```

### 6. Monitor Serial

**Desde Antigravity IDE:**
1. Paleta de comandos: `PlatformIO: Serial Monitor`
2. O click en el icono de "enchufe" en la barra inferior

**Desde Terminal:**
```bash
pio device monitor -b 115200
```

## Configuración de Tags

Cada tag en el array `tags` soporta:

- **name**: Nombre identificador del tag
- **address**: Dirección DF1 (formato: `TIPO##:ELEMENTO`)
  - Ejemplos: `N7:0`, `F8:10`, `B3:5`
- **size**: Número de elementos a leer
- **pollRate**: Intervalo de lectura en milisegundos
- **writeable**: Si permite escritura (true/false)

### Tipos de Datos Soportados

| Tipo | Código | Descripción | Bytes |
|------|--------|-------------|-------|
| N    | 0x89   | Integer (INT16) | 2 |
| F    | 0x8A   | Float (FLOAT32) | 4 |
| B    | 0x85   | Bit/Binary      | 2 |

## Formato de Mensajes MQTT

### Publicación de Datos

Tópico: `{topicPrefix}/data/plc`

Formato JSON:
```json
{
    "tag": "N7_0",
    "status": "OK",
    "value": [100, 200, 300]
}
```

### Estados Posibles

- `"status": "OK"` - Lectura exitosa
- `"status": "fail"` - Error en lectura

## Arquitectura del Código

```
esp32-version/
├── include/
│   ├── Config.h          # Gestión de configuración
│   ├── DF1Protocol.h     # Protocolo DF1
│   └── MQTTManager.h     # Cliente MQTT
├── src/
│   ├── Config.cpp
│   ├── DF1Protocol.cpp
│   ├── MQTTManager.cpp
│   └── main.cpp          # Programa principal
├── data/
│   └── config.json       # Configuración (se sube a SPIFFS)
└── platformio.ini        # Configuración del proyecto
```

## Diferencias con la Versión Node.js

### Ventajas de la Versión ESP32

1. **Hardware dedicado** - No requiere computadora
2. **WiFi integrado** - Más compacto que USB-Serial + PC
3. **Bajo consumo** - Ideal para instalaciones industriales
4. **Costo reducido** - ESP32 ~$5 USD
5. **Mayor confiabilidad** - Sistema embebido sin OS

### Limitaciones

1. **Memoria limitada** - Máximo 10 tags simultáneos (configurable en `Config.h`)
2. **Un solo puerto serial DF1** - La versión Node.js puede manejar múltiples puertos
3. **Debugging más complejo** - Requiere conexión serial

## Troubleshooting

### El ESP32 no se conecta a WiFi

- Verifica SSID y password en `config.json`
- Asegúrate de haber subido el filesystem (uploadfs)
- Revisa el monitor serial para ver errores

### No hay comunicación DF1

- Verifica las conexiones de hardware (RX/TX, GND)
- Confirma el baud rate del PLC (típicamente 19200)
- Usa un conversor de niveles RS-232 ↔ TTL
- Revisa que el cable serial esté correctamente conectado (null-modem si es necesario)

### MQTT no conecta

- Verifica que el broker MQTT esté accesible desde la red WiFi
- Prueba hacer ping al broker desde otro dispositivo en la misma red
- Revisa credenciales si el broker requiere autenticación

### Lecturas erróneas de datos

- Verifica que las direcciones de tags sean correctas en el PLC
- Confirma que el tipo de dato coincida (N, F, B)
- Revisa el tamaño (size) del tag

## Desarrollo y Debugging

### Niveles de Log

Edita `platformio.ini` para ajustar el nivel de debug:

```ini
build_flags =
    -D CORE_DEBUG_LEVEL=5  ; 0=None, 1=Error, 2=Warn, 3=Info, 4=Debug, 5=Verbose
```

### Monitor Serial con Filtros

```bash
# Ver solo mensajes de error
pio device monitor --filter esp32_exception_decoder

# Con velocidad específica
pio device monitor -b 115200
```

## Contribuciones

Las contribuciones son bienvenidas. Por favor:

1. Haz fork del proyecto
2. Crea una rama para tu feature (`git checkout -b feature/nueva-funcionalidad`)
3. Commit tus cambios (`git commit -am 'Añadir nueva funcionalidad'`)
4. Push a la rama (`git push origin feature/nueva-funcionalidad`)
5. Abre un Pull Request

## Licencia

ISC License - Mismo que el proyecto original

## Autor

Conversión a ESP32: Claude AI (Anthropic)
Proyecto original: José B. Salamanca Vargas

## Contacto

Para reportar problemas o sugerencias, abre un issue en el repositorio.
