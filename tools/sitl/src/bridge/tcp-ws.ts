// tcp-ws.ts — TCP→WebSocket binary relay for ArduPilot SITL MAVLink streams
// SPDX-License-Identifier: GPL-3.0-only

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TcpInstance {
  host: string;
  port: number;
  sysId: number;
}

export interface BridgeConfig {
  wsPort: number;
  tcpInstances: TcpInstance[];
}

export interface TcpConnectedEvent {
  sysId: number;
  host: string;
  port: number;
}

export interface TcpDisconnectedEvent {
  sysId: number;
}

export interface WsClientEvent {
  remoteAddress: string;
}

export interface DataEvent {
  sysId: number;
  data: Buffer;
}

export interface BridgeEvents {
  'tcp-connected': [TcpConnectedEvent];
  'tcp-disconnected': [TcpDisconnectedEvent];
  'ws-client-connected': [WsClientEvent];
  'ws-client-disconnected': [WsClientEvent];
  'data': [DataEvent];
  'error': [Error];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_RECONNECT_MS = 500;
const MAX_RECONNECT_MS = 30_000;
const BACKOFF_FACTOR = 2;

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

interface TcpHandle {
  instance: TcpInstance;
  socket: net.Socket | null;
  reconnectMs: number;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  destroyed: boolean;
}

export class TcpWsBridge extends EventEmitter<BridgeEvents> {
  private readonly config: BridgeConfig;
  /** One WebSocket server per drone, keyed by TCP port. */
  private readonly wssMap = new Map<number, WebSocketServer>();
  private readonly tcpHandles: TcpHandle[] = [];
  private closed = false;

  constructor(config: BridgeConfig) {
    super();
    this.config = config;
  }

  /** Number of currently connected WebSocket clients across all servers. */
  get wsClientCount(): number {
    let count = 0;
    for (const wss of this.wssMap.values()) {
      count += wss.clients.size;
    }
    return count;
  }

  /** Start per-drone WebSocket servers and connect to all TCP instances. */
  start(): void {
    for (const instance of this.config.tcpInstances) {
      // Each drone gets its own WebSocket server on its TCP port
      const wss = new WebSocketServer({ port: instance.port });

      wss.on('connection', (ws, req) => {
        const remoteAddress = req.socket.remoteAddress ?? 'unknown';
        this.emit('ws-client-connected', { remoteAddress });

        ws.binaryType = 'nodebuffer';

        ws.on('message', (msg: Buffer) => {
          // GCS → SITL: relay only to this drone's TCP connection
          const handle = this.tcpHandles.find((h) => h.instance.port === instance.port);
          if (handle?.socket && !handle.socket.destroyed) {
            handle.socket.write(msg);
          }
        });

        ws.on('close', () => {
          this.emit('ws-client-disconnected', { remoteAddress });
        });

        ws.on('error', (err) => {
          this.emit('error', err);
        });
      });

      wss.on('error', (err) => {
        this.emit('error', err);
      });

      this.wssMap.set(instance.port, wss);

      // Initiate TCP connection for this drone
      const handle: TcpHandle = {
        instance,
        socket: null,
        reconnectMs: INITIAL_RECONNECT_MS,
        reconnectTimer: null,
        destroyed: false,
      };
      this.tcpHandles.push(handle);
      this.connectTcp(handle);
    }
  }

  /** Gracefully shut down all sockets and WS servers. */
  shutdown(): void {
    this.closed = true;

    for (const handle of this.tcpHandles) {
      handle.destroyed = true;
      if (handle.reconnectTimer) {
        clearTimeout(handle.reconnectTimer);
        handle.reconnectTimer = null;
      }
      if (handle.socket) {
        handle.socket.destroy();
        handle.socket = null;
      }
    }

    for (const wss of this.wssMap.values()) {
      for (const client of wss.clients) {
        client.close();
      }
      wss.close();
    }
    this.wssMap.clear();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private connectTcp(handle: TcpHandle): void {
    if (handle.destroyed || this.closed) return;

    const { host, port, sysId } = handle.instance;
    const socket = new net.Socket();
    handle.socket = socket;

    socket.connect(port, host, () => {
      handle.reconnectMs = INITIAL_RECONNECT_MS; // reset backoff on success
      this.emit('tcp-connected', { sysId, host, port });
    });

    socket.on('data', (data: Buffer) => {
      // SITL → GCS: broadcast only to this drone's WS clients
      this.broadcastToWs(port, data);
      this.emit('data', { sysId, data });
    });

    socket.on('close', () => {
      this.emit('tcp-disconnected', { sysId });
      handle.socket = null;
      this.scheduleReconnect(handle);
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      // `close` event fires after `error`, so reconnect is handled there
    });
  }

  private scheduleReconnect(handle: TcpHandle): void {
    if (handle.destroyed || this.closed) return;

    handle.reconnectTimer = setTimeout(() => {
      handle.reconnectTimer = null;
      this.connectTcp(handle);
    }, handle.reconnectMs);

    // Exponential backoff with cap
    handle.reconnectMs = Math.min(
      handle.reconnectMs * BACKOFF_FACTOR,
      MAX_RECONNECT_MS,
    );
  }

  private broadcastToWs(tcpPort: number, data: Buffer): void {
    const wss = this.wssMap.get(tcpPort);
    if (!wss) return;
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
