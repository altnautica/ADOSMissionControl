/**
 * @module lib/atlas/world-stream
 * @description Client for the compute node's per-device world-model descriptor
 * stream.
 *
 * The node fans out world-model descriptors on a broadcast channel and serves
 * them over one WebSocket per device (`GET /ws/atlas/<device_id>`), beside the
 * job API on the engine's own listener rather than through the bounded MAVLink
 * queue. Each descriptor is tagged with the drone it belongs to and the handler
 * filters to its own device, so a multi-device node never cross-talks one
 * drone's world into another's view.
 *
 * Frames are binary msgpack `AtlasEvent`s. This module moves BYTES only: the
 * envelope check and the descriptor decode belong to the store, so a refusal is
 * counted in one place.
 *
 * A lagged subscriber is skipped by the publisher rather than blocking the
 * trainer, which is safe here in a way it would not be for a delta lane: each
 * descriptor is a complete statement about one generation, so a skipped frame
 * costs the consumer that generation and never desynchronises it.
 *
 * @license GPL-3.0-only
 */

import { openReconnectingSocket, type ReconnectingSocketLike } from "@/lib/net/reconnecting-socket";

/** The route the node serves, one path per device (the agent's own constant). */
export const WORLD_WS_ROUTE = "/ws/atlas/:device_id";

/** The compute engine's own listener port, where the stream is mounted beside
 * the job API — not the `:8080` ados-control front. */
export const WORLD_STREAM_PORT = "8092";

/** The concrete WS path for a device. */
export function worldWsPath(deviceId: string): string {
  return `/ws/atlas/${encodeURIComponent(deviceId)}`;
}

/**
 * The descriptor-stream URL for `deviceId` on the compute node reachable at
 * `nodeBaseUrl` (an `http(s)://host[:port]` LAN base), or null when the base is
 * not a URL.
 *
 * The engine port is swapped in because the stream rides the job listener, and
 * the scheme is carried across (`https` → `wss`) rather than assumed.
 */
export function worldStreamUrl(
  nodeBaseUrl: string,
  deviceId: string,
): string | null {
  try {
    const u = new URL(nodeBaseUrl);
    u.port = WORLD_STREAM_PORT;
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    return `${u.origin}${worldWsPath(deviceId)}`;
  } catch {
    return null;
  }
}

/** The subset of `WebSocket` this client drives, so a test can inject one. */
export interface WorldStreamSocket extends ReconnectingSocketLike {
  binaryType: string;
}

export type WorldStreamState = "connecting" | "connected" | "reconnecting";

export interface WorldStreamOptions {
  url: string;
  /** One decoded-nothing frame: raw envelope bytes. */
  onFrame: (frame: Uint8Array) => void;
  onState: (state: WorldStreamState) => void;
  /** Socket constructor; defaults to the global `WebSocket`. */
  socketFactory?: (url: string) => WorldStreamSocket;
}

/**
 * Open the descriptor stream, reconnecting until the returned unsubscribe is
 * called. Returns a no-op teardown when there is no `WebSocket` available (SSR).
 */
export function subscribeWorldStream(opts: WorldStreamOptions): () => void {
  const factory =
    opts.socketFactory ??
    (typeof WebSocket !== "undefined" ? (url: string) => new WebSocket(url) : null);
  if (factory === null) return () => {};

  return openReconnectingSocket({
    open: () => {
      const ws = factory(opts.url);
      ws.binaryType = "arraybuffer";
      return ws;
    },
    onMessage: (data) => {
      // Descriptors are binary. A text frame is off-contract; ignoring it keeps
      // a chatty proxy from being counted as a malformed descriptor.
      if (data instanceof ArrayBuffer) {
        opts.onFrame(new Uint8Array(data));
      } else if (data instanceof Uint8Array) {
        opts.onFrame(data);
      }
    },
    // Teardown is the caller's own act, not a stream state it tracks.
    onState: (state) => {
      if (state !== "closed") opts.onState(state);
    },
  });
}
