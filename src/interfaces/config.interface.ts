export interface DF1Config {
    port: string;
    baudRate: number;
}

export interface MQTTConfig {
    brokerUrl: string;
    clientId: string;
    username?: string;
    password?: string;
    topicPrefix: string;
}

export interface TagConfig {
    name: string;
    address: string;
    size: number;
    pollRate: number;
    writeable?: boolean;
}

export interface GatewayConfig {
    df1: DF1Config;
    mqtt: MQTTConfig;
    tags: TagConfig[];
}
