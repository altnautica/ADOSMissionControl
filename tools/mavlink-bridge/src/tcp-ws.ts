// tcp-ws.ts — TCP ↔ WebSocket binary relay for MAVLink streams
// SPDX-License-Identifier: GPL-3.0-only

import { EventEmitter } from 'node:events';
import net from 'node:net';
import { WebSocketServer, WebSocket } from 'ws';
import type { Bridge, BridgeEvents } from './types.js';
import { wsVerifyClient, type WsGuardOptions } from './ws-guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Fixed retry interval: the link is retried every 2 s, forever. */
const RECONNECT_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TcpWsBridgeConfig extends WsGuardOptions {
  /** WebSocket port the GCS connects to. */
  wsPort: number;
  /** WebSocket bind address (loopback unless the operator opts in). */
  wsHost: string;
  host: string;
  port: number;
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class TcpWsBridge extends EventEmitter<BridgeEvents> implements Bridge {
  private readonly config: TcpWsBridgeConfig;
  private wss: WebSocketServer | null = null;
  private socket: net.Socket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(config: TcpWsBridgeConfig) {
    super();
    this.config = config;
  }

  /** Number of currently connected WebSocket clients. */
  get wsClientCount(): number {
    return this.wss ? this.wss.clients.size : 0;
  }

  /** Start the WebSocket server and connect out to the TCP endpoint. */
  start(): void {
    const wss = new WebSocketServer({
      port: this.config.wsPort,
      host: this.config.wsHost,
      verifyClient: wsVerifyClient(this.config),
    });
    this.wss = wss;

    wss.on('connection', (ws, req) => {
      const remoteAddress = req.socket.remoteAddress ?? 'unknown';
      this.emit('ws-client-connected', { remoteAddress });

      ws.binaryType = 'nodebuffer';

      ws.on('message', (msg: Buffer) => {
        // GCS → drone
        if (this.socket && !this.socket.destroyed) {
          this.socket.write(msg);
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

    this.connect();
  }

  /** Gracefully shut down the TCP socket and WebSocket server. */
  shutdown(): void {
    this.closed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    if (this.wss) {
      for (const client of this.wss.clients) {
        client.close();
      }
      this.wss.close();
      this.wss = null;
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private connect(): void {
    if (this.closed) return;

    const { host, port } = this.config;
    const socket = new net.Socket();
    this.socket = socket;

    socket.connect(port, host, () => {
      this.emit('connected', { host, port });
    });

    socket.on('data', (data: Buffer) => {
      // drone → GCS
      this.broadcastToWs(data);
      this.emit('data', { data });
    });

    socket.on('close', () => {
      this.emit('disconnected', { host, port });
      this.socket = null;
      this.scheduleReconnect();
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      // `close` fires after `error`, so reconnect is scheduled there.
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, RECONNECT_MS);

    // Exponential backoff with cap.
  }

  private broadcastToWs(data: Buffer): void {
    if (!this.wss) return;
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }
}
