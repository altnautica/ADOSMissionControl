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
  /**
   * Whether bytes written to this transport actually reach the vehicle.
   *
   * Separate from `isConnected` because the two genuinely differ: a relay
   * transport can hold an open, healthy socket that delivers telemetry while
   * every byte sent the other way is discarded downstream. `isConnected`
   * answers "is the pipe up", which such a transport answers truthfully with
   * yes; this answers "will a command survive the trip".
   *
   * Required rather than optional so each transport has to state its answer.
   * An optional flag would default to undefined, read as falsey-or-truthy
   * depending on the caller, and let a future transport inherit "yes" by
   * saying nothing — which is the failure being fixed here.
   */
  readonly canCommand: boolean;
}

/** Optional middleware for intercepting transport data (e.g., encryption). */
export interface TransportMiddleware {
  wrapOutbound(data: Uint8Array): Uint8Array;
  unwrapInbound(data: Uint8Array): Uint8Array;
}
