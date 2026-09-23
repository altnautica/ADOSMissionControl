// udp-ws.ts — UDP ↔ WebSocket binary relay for MAVLink streams
// SPDX-License-Identifier: GPL-3.0-only

import { EventEmitter } from 'node:events';
import dgram from 'node:dgram';
import { WebSocketServer, WebSocket } from 'ws';
import type { Bridge, BridgeEvents, PeerEvent } from './types.js';
import { UdpPeerTracker } from './udp-peer.js';
import { wsVerifyClient, type WsGuardOptions } from './ws-guard.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// UDP is connectionless, so "reconnect" maps to rebinding the socket after an
// error using the same backoff discipline the TCP relay uses.
/** Fixed retry interval: the bind is retried every 2 s, forever. */
const REBIND_MS = 2000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UdpMode = 'listen' | 'target';

export interface UdpWsBridgeConfig extends WsGuardOptions {
  /** WebSocket port the GCS connects to. */
  wsPort: number;
  /** WebSocket bind address (loopback unless the operator opts in). */
  wsHost: string;
  /**
   * `listen` (udpin): bind to host:port and learn the remote peer once, from
   * the first local-source MAVLink datagram (MAVProxy semantics, e.g.
   * `--out=udp:HOST:PORT`). `target` (udpout): send to a fixed host:port.
   */
  mode: UdpMode;
  host: string;
  port: number;
}

interface UdpBridgeEvents extends BridgeEvents {
  'peer-learned': [PeerEvent];
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export class UdpWsBridge extends EventEmitter<UdpBridgeEvents> implements Bridge {
  private readonly config: UdpWsBridgeConfig;
  private readonly family: dgram.SocketType;
  private wss: WebSocketServer | null = null;
  private socket: dgram.Socket | null = null;
  /** Lives as long as the bridge: a socket rebind never re-opens learning. */
  private readonly peers: UdpPeerTracker;
  private rebindTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;

  constructor(config: UdpWsBridgeConfig) {
    super();
    this.config = config;
    // IPv6 host literals contain a colon; everything else is treated as IPv4.
    this.family = config.host.includes(':') ? 'udp6' : 'udp4';
    this.peers = new UdpPeerTracker(
      config.mode === 'target' ? { host: config.host, port: config.port } : null,
    );
  }

  /** Where GCS-to-vehicle bytes go, or null before a peer is known. */
  get peer(): PeerEvent | null {
    return this.peers.peer;
  }

  /** Number of currently connected WebSocket clients. */
  get wsClientCount(): number {
    return this.wss ? this.wss.clients.size : 0;
  }

  /** Start the WebSocket server and bind the UDP socket. */
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
        // GCS → drone. In listen mode this only sends once a peer is known.
        this.sendToPeer(msg);
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

    this.bind();
  }

  /** Gracefully shut down the UDP socket and WebSocket server. */
  shutdown(): void {
    this.closed = true;

    if (this.rebindTimer) {
      clearTimeout(this.rebindTimer);
      this.rebindTimer = null;
    }
    this.teardownSocket();

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

  private bind(): void {
    if (this.closed) return;

    const socket = dgram.createSocket(this.family);
    this.socket = socket;

    socket.on('message', (msg: Buffer, rinfo: dgram.RemoteInfo) => {
      const verdict = this.peers.observe(rinfo.address, rinfo.port, msg);
      if (verdict === 'drop') return;
      if (verdict === 'learned') {
        this.emit('peer-learned', { host: rinfo.address, port: rinfo.port });
      }
      // drone → GCS: broadcast to every WS client.
      this.broadcastToWs(msg);
      this.emit('data', { data: msg });
    });

    socket.on('listening', () => {
      this.emit('connected', { host: this.config.host, port: this.config.port });
    });

    socket.on('error', (err) => {
      this.emit('error', err);
      this.teardownSocket();
      this.scheduleRebind();
    });

    if (this.config.mode === 'listen') {
      socket.bind(this.config.port, this.config.host);
    } else {
      // target (udpout): the peer is fixed; bind an ephemeral local port so the
      // peer's replies are received on the same socket.
      socket.bind();
    }
  }

  private scheduleRebind(): void {
    if (this.closed) return;

    this.emit('disconnected', { host: this.config.host, port: this.config.port });

    this.rebindTimer = setTimeout(() => {
      this.rebindTimer = null;
      this.bind();
    }, REBIND_MS);

    // Exponential backoff with cap.
  }

  private teardownSocket(): void {
    if (!this.socket) return;
    try {
      this.socket.removeAllListeners();
      this.socket.close();
    } catch {
      // Socket may have failed before binding; closing throws. Ignore.
    }
    this.socket = null;
  }

  private sendToPeer(msg: Buffer): void {
    const socket = this.socket;
    const peer = this.peers.peer;
    // No peer learned yet (listen mode before the vehicle's first frame) → drop.
    if (!socket || !peer) return;
    socket.send(msg, peer.port, peer.host, (err) => {
      if (err) this.emit('error', err);
    });
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
