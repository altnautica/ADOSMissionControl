/**
 * MQTT FC-frame relay transport — relays raw FC frames over MQTT.
 * Used for cloud/remote GCS access when a direct WebSocket to the
 * agent is unavailable (user not on same LAN). Byte-transparent: it
 * carries whichever protocol the FC speaks, selected by the topic lane.
 *
 * Data flow (lane = "mavlink" for a MAVLink FC, "msp" for a Betaflight/iNav FC):
 *   FC → Agent → MQTT (ados/{id}/{lane}/tx) → Browser GCS
 *   Browser GCS → MQTT (ados/{id}/{lane}/rx) → Agent → FC
 *
 * @module protocol/transport/mqtt-mavlink
 * @license GPL-3.0-only
 */

import type { Transport, TransportEventMap } from "../types/transport";
import {
  getMqttBrokerCredential,
  notifyBrokerWriteAccepted,
} from "@/lib/mqtt-broker-credential";
import { OFFICIAL_MQTT_WS_URL } from "@/lib/config/endpoints";

const MQTT_WS_URL = OFFICIAL_MQTT_WS_URL;
const CONNECT_TIMEOUT_MS = 10_000;

/** Which cloud topic pair the relay uses — the MAVLink lane or the MSP lane. */
export type MqttRelayLane = "mavlink" | "msp";

export class MqttMavlinkTransport implements Transport {
  readonly type = "mqtt-mavlink" as const;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private client: any = null;
  private _connected = false;
  private _disconnecting = false;
  private _canPublish = false;
  private deviceId = "";

  /**
   * Whether the broker will accept what this transport publishes.
   *
   * Unlike a direct transport, an open socket here proves only that the broker
   * accepted the CONNECT. The subscribe side and the publish side are
   * authorised separately, so a credential that streams telemetry perfectly can
   * have every publish discarded — and at QoS 0 the discard is silent, because
   * the protocol acknowledges nothing at that quality of service. There is no
   * error to observe and no callback to wait for; the frames simply stop.
   *
   * So this is answered from the credential the caller supplied rather than
   * from anything observed on the wire, and it defaults to false. A caller that
   * does not say its credential may publish gets told it may not, which is the
   * safe direction to be wrong in: an under-claim shows the operator a limit
   * that is not there, an over-claim shows a working link that silently drops
   * every command.
   */
  get canCommand(): boolean {
    return this._canPublish;
  }
  /** Topic lane: "mavlink" for a MAVLink FC, "msp" for a Betaflight/iNav FC. */
  private readonly lane: MqttRelayLane;
  private listeners: Map<
    keyof TransportEventMap,
    Set<(data: never) => void>
  > = new Map();

  /**
   * @param lane Which cloud topic pair to relay over. Defaults to "mavlink"
   *   so existing MAVLink callers are unchanged; pass "msp" for an MSP FC.
   */
  constructor(lane: MqttRelayLane = "mavlink") {
    this.lane = lane;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  /**
   * Connect to MQTT broker and subscribe to MAVLink frame topic.
   * @param deviceId — Agent device ID (used in topic path)
   * @param brokerUrl — MQTT WebSocket URL (default: the managed broker, see config/endpoints)
   * @param auth — Optional broker username/password (the production broker
   *   enforces auth against the operator's own minted write grant). Set
   *   `canPublish` only for a credential the broker will accept writes from;
   *   `relayWriteAuthFor` in the grant store is the one producer of that claim,
   *   and a session without a grant must leave it unset.
   */
  async connect(
    deviceId: string,
    brokerUrl?: string,
    auth?: {
      username?: string | null;
      password?: string | null;
      canPublish?: boolean;
    },
  ): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }

    this.deviceId = deviceId;
    const topicTx = `ados/${deviceId}/${this.lane}/tx`;

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

        const connectOptions: Record<string, unknown> = {
          protocolVersion: 5,
          clean: true,
          reconnectPeriod: 5000,
          // Drop QoS-0 publishes while the socket is offline instead of
          // buffering them. MAVLink command frames are time-sensitive;
          // replaying a stale ARM/PARAM_SET after a reconnect is worse
          // than dropping it (the caller already saw an ACK timeout).
          queueQoSZero: false,
        };
        const cred = auth ?? getMqttBrokerCredential();
        if (cred?.username && cred?.password) {
          connectOptions.username = cred.username;
          connectOptions.password = cred.password;
        }
        // Fail closed: only an explicit claim grants publish authority. The
        // process-wide fallback credential is a grant scoped to the drones this
        // operator owns, and this transport cannot tell whether the drone it was
        // handed is one of them — so the caller that resolved the grant has to
        // say, and silence means no.
        this._canPublish =
          auth?.canPublish === true && Boolean(cred?.username && cred?.password);
        this.client = (connectFn as typeof mqttModule.connect)(
          brokerUrl || MQTT_WS_URL,
          connectOptions,
        );

        // mqtt.js fires 'connect' on every (re)connect. We resubscribe
        // each time because the previous session's subscriptions are
        // dropped on a `clean: true` reconnect. Subscribe error
        // callback surfaces broker ACL denials that previously failed
        // silently and stalled the transport waiting for frames.
        this.client.on("connect", () => {
          this._connected = true;
          this.client.subscribe(
            topicTx,
            { qos: 0 },
            (err: Error | null) => {
              if (err) {
                this.emit("error", err);
              }
            },
          );
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
          const wasIntentional = this._disconnecting;
          this._connected = false;
          // The 'close' event is the moment an intentional disconnect is
          // actually observed, so clear the flag here (not eagerly in
          // disconnect()). A spurious close during an in-flight
          // disconnect is suppressed; an unsolicited close emits so the
          // drone is torn down rather than zombied on a dead link.
          this._disconnecting = false;
          if (wasConnected && !wasIntentional) {
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

  /** Send raw FC bytes to agent via MQTT. */
  send(data: Uint8Array): void {
    if (!this._connected || !this.client) {
      throw new Error("Not connected");
    }
    // Refuse rather than publish into a void. Handing this frame to the broker
    // would look identical to success — QoS 0 acknowledges nothing, so the
    // caller would wait out a command timeout and blame the aircraft for a
    // refusal that happened here. Failing at the call site names the cause
    // while the caller still has the context to report it.
    if (!this._canPublish) {
      throw new Error(
        "Relay credential is receive-only: this session cannot send commands to the vehicle",
      );
    }
    // QoS-0 publish is unreliable by design (no broker ACK), so a frame
    // can vanish while the caller waits on a COMMAND_ACK. Surface the
    // local publish error (serialization, full offline queue, closed
    // socket) instead of dropping it silently, so the command layer can
    // fail fast rather than only timing out.
    this.client.publish(
      `ados/${this.deviceId}/${this.lane}/rx`,
      Buffer.from(data),
      { qos: 0 },
      (err: Error | null | undefined) => {
        if (err) {
          this.emit("error", err);
          return;
        }
        // The broker took the frame. That is the only proof a write grant is
        // live that this browser can ever obtain — QoS 0 acknowledges nothing —
        // so report it, and the grant owner stops hedging what it tells the
        // operator. Reported once per credential; a no-op after that.
        notifyBrokerWriteAccepted();
      },
    );
  }

  /** Disconnect from MQTT broker. */
  async disconnect(): Promise<void> {
    if (this._disconnecting) return;
    this._disconnecting = true;
    this._connected = false;
    const client = this.client;
    if (client) {
      // mqtt.js fires 'close' asynchronously after end(). The 'close'
      // handler (mirroring the WebSocket transport) is the single
      // authority that clears _disconnecting, so an in-flight 'close' is
      // still recognised as intentional and suppressed; resetting here
      // eagerly would let a late 'close' read _disconnecting === false
      // and emit a spurious close that zombies the drone. A safety timer
      // clears the flag if the broker never delivers 'close'.
      try {
        client.end(true);
      } catch { /* noop */ }
      setTimeout(() => {
        this._disconnecting = false;
      }, CONNECT_TIMEOUT_MS);
      this.client = null;
    } else {
      this._disconnecting = false;
    }
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
