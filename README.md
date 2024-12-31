# DF1_to_MQTT
# DF1-MQTT Gateway

DF1-MQTT Gateway es una aplicación que permite la comunicación entre dispositivos que utilizan el protocolo DF1 y un broker MQTT. Este proyecto está diseñado para facilitar la integración de dispositivos industriales con sistemas de monitoreo y control basados en MQTT.

## Características

- Comunicación con dispositivos DF1.
- Publicación de datos en un broker MQTT.
- Reintentos automáticos de conexión en caso de fallos.
- Manejo de errores robusto.

## Requisitos

- Node.js (versión 14 o superior)
- npm (versión 6 o superior)

## Instalación

1. Clona el repositorio:

    ```sh
    git clone https://github.com/Jobensa/DF1_to_MQTT.git
    cd df1-mqtt-gateway
    ```

2. Instala las dependencias:

    ```sh
    npm install
    ```

## Configuración

1. Crea un archivo de configuración [config.json](http://_vscodecontentref_/1) en el directorio raíz del proyecto con el siguiente contenido:

    ```json
    {
        "df1": {
            "baudRate": 19200,
            "port": "/dev/ttyUSB0"
        },
        "mqtt": {
            "brokerUrl": "mqtt://localhost:1883",
            "clientId": "df1-gateway",
            "topicPrefix": "plc/df1"
        },
        "tags": [
            {
                "address": "N7:0",
                "name": "production_count",
                "pollRate": 1000,
                "size": 10,
                "writeable": true
            },
            {
                "address": "F8:0",
                "name": "temperature",
                "pollRate": 500,
                "size": 10
            }
        ]
    }
    ```

2. Ajusta los valores de configuración según tus necesidades.

## Uso

1. Inicia la aplicación en modo desarrollo:

    ```sh
    npm run dev
    ```

2. La aplicación intentará conectarse al dispositivo DF1 y al broker MQTT. Los datos se publicarán en el broker MQTT según la configuración especificada.

## Manejo de Errores

- La aplicación maneja automáticamente los errores de conexión y reintenta conectarse en caso de fallos.
- Los errores se registran en la consola para facilitar la depuración.

## Contribución

¡Las contribuciones son bienvenidas! Si deseas contribuir a este proyecto, por favor sigue estos pasos:

1. Haz un fork del repositorio.
2. Crea una nueva rama (`git checkout -b feature/nueva-funcionalidad`).
3. Realiza tus cambios y haz commit (`git commit -am 'Añadir nueva funcionalidad'`).
4. Sube tus cambios a tu fork (`git push origin feature/nueva-funcionalidad`).
5. Abre un Pull Request en el repositorio original.

## Licencia

Este proyecto está licenciado bajo la Licencia MIT. Consulta el archivo LICENSE para obtener más información.

## Contacto

Si tienes alguna pregunta o sugerencia, no dudes en ponerte en contacto con nosotros a través de [tu-email@example.com](mailto:tu-email@example.com).
