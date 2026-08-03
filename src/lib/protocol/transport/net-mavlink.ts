/**
 * @module net-mavlink
 * @description UDP / TCP MAVLink transport. A browser sandbox cannot open a raw
 * UDP or TCP socket, so this transport reaches one of two ways, chosen at runtime:
 *
 *   - Desktop (Electron): a native `dgram`/`net` socket lives in the main process
 *     and is driven over IPC (`window.electronAPI.net`). This is the classic GCS
 *     UDP/TCP link (like Mission Planner / QGroundControl).
 *   - Browser: the bytes ride a WebSocket to a small local bridge process
 *     (`@altnautica/mavlink-bridge`) that owns the real UDP/TCP socket.
 *
 * Either way the rest of the stack is unchanged — the protocol adapter only sees
 * a byte-level `Transport`. The reported `type` is `udp-proxy` / `tcp` so the
 * existing link badges render correctly regardless of which path is used.
 * @license GPL-3.0-only
 */

import type { Transport } from "../types";
import { WebSocketTransport } from "./websocket";
import { isElectron } from "@/lib/utils";

export type NetProto = "udp" | "tcp";
export type UdpMode = "listen" | "target";

export interface NetConnectOptions {
  proto: NetProto;
  host: string;
  port: number;
  /** UDP only; defaults to "listen". */
  mode?: UdpMode;
  /** Browser bridge WebSocket URL; defaults to {@link DEFAULT_BRIDGE_URL}. */
  bridgeUrl?: string;
}

type TransportEventMap = {
  data: Uint8Array;
  close: void;
  error: Error;
};

/** Default WebSocket URL the local bridge listens on in the browser path. */
export const DEFAULT_BRIDGE_URL = "ws://localhost:14551";

/**
 * Parse a connection-string endpoint into structured fields. Accepts
 * `udp:host:port`, `udpin:host:port` (= listen), `udpout:host:port` (= target),
 * and `tcp:host:port`. A bare `host:port` is treated as UDP listen. Returns
 * null when the string can't be parsed. Pure — safe to unit test.
 */
export function parseEndpointSpec(spec: string): NetConnectOptions | null {
  const trimmed = spec.trim();
  if (!trimmed) return null;

  let proto: NetProto = "udp";
  let mode: UdpMode = "listen";
  let rest = trimmed;

  const colon = trimmed.indexOf(":");
  const scheme = colon > 0 ? trimmed.slice(0, colon).toLowerCase() : "";
  if (scheme === "tcp" || scheme === "tcpin" || scheme === "tcpout") {
    proto = "tcp";
    rest = trimmed.slice(colon + 1);
  } else if (scheme === "udp" || scheme === "udpin") {
    proto = "udp";
    mode = "listen";
    rest = trimmed.slice(colon + 1);
  } else if (scheme === "udpout") {
    proto = "udp";
    mode = "target";
    rest = trimmed.slice(colon + 1);
  }

  // `rest` is now `host:port` (host may be empty for a bare `:port`).
  const lastColon = rest.lastIndexOf(":");
  if (lastColon < 0) return null;
  const host = rest.slice(0, lastColon) || "0.0.0.0";
  const port = Number.parseInt(rest.slice(lastColon + 1), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;

  return proto === "udp" ? { proto, host, port, mode } : { proto, host, port };
}

export class NetMavlinkTransport implements Transport {
  readonly type: "udp-proxy" | "tcp";
  /**
   * A direct link: bytes written here go to the flight controller over this
   * connection, so a command that leaves is a command that arrives.
   */
  readonly canCommand = true;

  private readonly proto: NetProto;
  private _connected = false;
  private _disconnecting = false;
  private listeners: Map<keyof TransportEventMap, Set<(data: never) => void>> =
    new Map();

  // Desktop (Electron) path
  private socketId: string | null = null;
  private offData: (() => void) | null = null;
  private offClose: (() => void) | null = null;

  // Browser (bridge) path
  private ws: WebSocketTransport | null = null;

  constructor(proto: NetProto) {
    this.proto = proto;
    this.type = proto === "udp" ? "udp-proxy" : "tcp";
  }

  get isConnected(): boolean {
    return this._connected;
  }

  async connect(opts: NetConnectOptions): Promise<void> {
    if (this._connected) {
      throw new Error("Already connected");
    }
    const net =
      typeof window !== "undefined" ? window.electronAPI?.net : undefined;

    if (isElectron() && net) {
      await this.connectNative(net, opts);
    } else {
      await this.connectBridge(opts);
    }
  }

  /** Open a real socket in the Electron main process over IPC. */
  private async connectNative(
    net: NonNullable<NonNullable<Window["electronAPI"]>["net"]>,
    opts: NetConnectOptions,
  ): Promise<void> {
    const { id } = await net.open({
      proto: opts.proto,
      host: opts.host,
      port: opts.port,
      mode: opts.proto === "udp" ? opts.mode ?? "listen" : undefined,
    });
    this.socketId = id;

    this.offData = net.onData((msg) => {
      if (msg.id !== id) return;
      const bytes =
        msg.data instanceof Uint8Array ? msg.data : new Uint8Array(msg.data);
      this.emit("data", bytes);
    });
    this.offClose = net.onClose((msg) => {
      if (msg.id !== id) return;
      const wasConnected = this._connected;
      this._connected = false;
      // Surface the failure reason (ECONNREFUSED/ECONNRESET/...) like the
      // WebSocket and bridge transports do, before the close.
      if (msg.reason) this.emit("error", new Error(msg.reason));
      // Self-clean the IPC subscriptions + socket id. On an UNEXPECTED close the
      // adapter flips its own connected=false first, so drone-manager skips
      // transport.disconnect() — without this, every unexpected disconnect would
      // leak the net:data/net:close listeners on the shared ipcRenderer channel.
      this.offData?.();
      this.offData = null;
      this.offClose?.();
      this.offClose = null;
      this.socketId = null;
      if (wasConnected && !this._disconnecting) {
        this.emit("close", undefined as never);
      }
    });

    this._connected = true;
  }

  /** Reach a local bridge process over a WebSocket (the browser path). */
  private async connectBridge(opts: NetConnectOptions): Promise<void> {
    const url = opts.bridgeUrl?.trim() || DEFAULT_BRIDGE_URL;
    const ws = new WebSocketTransport();
    ws.on("data", (d) => this.emit("data", d));
    ws.on("error", (e) => this.emit("error", e));
    ws.on("close", () => {
      const wasConnected = this._connected;
      this._connected = false;
      if (wasConnected && !this._disconnecting) {
        this.emit("close", undefined as never);
      }
    });
    await ws.connect(url);
    this.ws = ws;
    this._connected = true;
  }

  send(data: Uint8Array): void {
    if (!this._connected) {
      throw new Error("Not connected");
    }
    if (this.ws) {
      this.ws.send(data);
      return;
    }
    const net =
      typeof window !== "undefined" ? window.electronAPI?.net : undefined;
    if (this.socketId && net) {
      // Fire-and-forget: MAVLink tolerates loss, so we don't block on the ack.
      void net.send(this.socketId, data).catch(() => {});
      return;
    }
    throw new Error("Not connected");
  }

  async disconnect(): Promise<void> {
    if (this._disconnecting) return;
    this._disconnecting = true;
    this._connected = false;

    if (this.ws) {
      try {
        await this.ws.disconnect();
      } catch {
        /* ignore */
      }
      this.ws = null;
    }

    const net =
      typeof window !== "undefined" ? window.electronAPI?.net : undefined;
    if (this.socketId && net) {
      try {
        await net.close(this.socketId);
      } catch {
        /* ignore */
      }
    }
    this.offData?.();
    this.offData = null;
    this.offClose?.();
    this.offClose = null;
    this.socketId = null;

    this._disconnecting = false;
    this.emit("close", undefined as never);
  }

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
        // Don't let a listener error crash the transport.
      }
    }
  }
}
