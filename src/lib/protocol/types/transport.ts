/**
 * Transport-level types for the protocol abstraction layer.
 *
 * @module protocol/types/transport
 */

/** Events emitted by a byte-level transport. */
export type TransportEventMap = {
  data: Uint8Array;
  close: void;
  error: Error;
};

/** Generic byte-level connection to a flight controller. */
export interface Transport {
  readonly type: "webserial" | "websocket" | "tcp" | "udp-proxy" | "mqtt-mavlink" | "ble";
  connect(...args: unknown[]): Promise<void>;
  disconnect(): Promise<void>;
  send(data: Uint8Array): void;
  on<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void;
  off<K extends keyof TransportEventMap>(
    event: K,
    handler: (data: TransportEventMap[K]) => void,
  ): void;
  readonly isConnected: boolean;
}

/** Optional middleware for intercepting transport data (e.g., encryption). */
export interface TransportMiddleware {
  wrapOutbound(data: Uint8Array): Uint8Array;
  unwrapInbound(data: Uint8Array): Uint8Array;
}
