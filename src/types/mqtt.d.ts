/**
 * @description Minimal type declarations for the mqtt package (dynamic import).
 * @license GPL-3.0-only
 */

declare module "mqtt" {
  interface MqttClientOptions {
    protocolVersion?: number;
    clean?: boolean;
    reconnectPeriod?: number;
    username?: string;
    password?: string;
  }

  interface MqttClient {
    on(event: "connect", cb: () => void): this;
    on(event: "close", cb: () => void): this;
    on(event: "error", cb: (err: Error) => void): this;
    on(event: "message", cb: (topic: string, payload: Buffer) => void): this;
    subscribe(topic: string | string[]): this;
    unsubscribe(topic: string | string[]): this;
    publish(topic: string, message: string | Buffer): this;
    end(force?: boolean): this;
  }

  export function connect(url: string, opts?: MqttClientOptions): MqttClient;
}
