/**
 * MQTT MAVLink Transport — relays raw MAVLink frames over MQTT.
 * Used for cloud/remote GCS access when direct WebSocket to the
 * agent is unavailable (user not on same LAN).
 *
 * Data flow:
 *   FC → Agent → MQTT (ados/{id}/mavlink/tx) → Browser GCS
 *   Browser GCS → MQTT (ados/{id}/mavlink/rx) → Agent → FC
 *
 * @module protocol/transport/mqtt-mavlink
 * @license GPL-3.0-only
 */

import type { Transport, TransportEventMap } from "../types/transport";

const MQTT_WS_URL = "wss://mqtt.altnautica.com/mqtt";
const CONNECT_TIMEOUT_MS = 10_000;

export class MqttMavlinkTransport implements Transport {
  readonly type = "mqtt-mavlink" as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private _connected = false;
  private _disconnecting = false;
  private deviceId = "";
  private listeners: Map<
    keyof TransportEventMap,
    Set<(data: never) => void>
  > = new Map();

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to MQTT broker and subscribe to MAVLink frame topic.
   * @param deviceId — Agent device ID (used in topic path)
   * @param brokerUrl — MQTT WebSocket URL (default: mqtt.altnautica.com)
   */
  async connect(deviceId: string, brokerUrl?: string): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    this.deviceId = deviceId;
    const topicTx = `ados/${deviceId}/mavlink/tx`;

    return new Promise<void>(async (resolve, reject) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { this.client?.end(true); } catch { /* noop */ }
          reject(new Error("MQTT connection timeout"));
        }
      }, CONNECT_TIMEOUT_MS);

      try {
        const mqttModule = await import("mqtt");

        // Handle ESM/CJS module resolution (same as MqttBridge.tsx)
        const connectFn = mqttModule.connect
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ?? (mqttModule.default as any)?.connect
          ?? mqttModule.default;

        if (typeof connectFn !== "function") {
          throw new Error("mqtt.connect not found in module");
        }

        this.client = (connectFn as typeof mqttModule.connect)(
          brokerUrl || MQTT_WS_URL,
          {
            protocolVersion: 5,
            clean: true,
            reconnectPeriod: 5000,
          },
        );

        this.client.on("connect", () => {
          this._connected = true;
          this.client.subscribe(topicTx, { qos: 0 });
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            resolve();
          }
        });

        this.client.on("error", (err: Error) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timer);
            reject(err);
          } else if (this._connected) {
            this.emit("error", err);
          }
        });

        this.client.on("message", (_topic: string, payload: Uint8Array | Buffer) => {
          // Raw binary MAVLink frame from agent
          const bytes =
            payload instanceof Uint8Array
              ? payload
              : new Uint8Array(payload);
          this.emit("data", bytes);
        });

        this.client.on("close", () => {
          const wasConnected = this._connected;
          this._connected = false;
          if (wasConnected && !this._disconnecting) {
            this.emit("close", undefined as never);
          }
        });
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  }

  /** Send raw MAVLink bytes to agent via MQTT. */
  send(data: Uint8Array): void {
    if (!this._connected || !this.client) {
      throw new Error("Not connected");
    }
    this.client.publish(
      `ados/${this.deviceId}/mavlink/rx`,
      Buffer.from(data),
      { qos: 0 },
    );
  }

  /** Disconnect from MQTT broker. */
  async disconnect(): Promise<void> {
    if (this._disconnecting) return;
    this._disconnecting = true;
    this._connected = false;
    if (this.client) {
      try {
        this.client.end(true);
      } catch { /* noop */ }
      this.client = null;
    }
    this._disconnecting = false;
  }

  // ── EventEmitter (same pattern as WebSocketTransport) ──────

  on<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as (data: never) => void);
  }

  off<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void {
    this.listeners.get(event)?.delete(handler as (data: never) => void);
  }

  private emit<K extends keyof TransportEventMap>(
    event: K,
    data: TransportEventMap[K],
  ): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        (handler as (data: TransportEventMap[K]) => void)(data);
      } catch {
        // Don't let listener errors crash the transport
      }
    }
  }
}
