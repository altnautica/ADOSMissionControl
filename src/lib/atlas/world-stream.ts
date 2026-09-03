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

/** The route the node serves, one path per device (the agent's own constant). */
export const WORLD_WS_ROUTE = "/ws/atlas/:device_id";

/** The compute engine's own listener port, where the stream is mounted beside
 * the job API — not the `:8080` ados-control front. */
export const WORLD_STREAM_PORT = "8092";

/** First reconnect delay, doubling to {@link WORLD_STREAM_MAX_RETRY_MS}. */
const WORLD_STREAM_RETRY_MS = 500;
/** Reconnect ceiling. A compute node that is simply not up yet is the common
 * case, so the poll settles to a calm cadence rather than hammering. */
export const WORLD_STREAM_MAX_RETRY_MS = 10_000;

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
export interface WorldStreamSocket {
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  close: () => void;
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
  const globalFactory =
    typeof WebSocket !== "undefined"
      ? (url: string) => new WebSocket(url) as unknown as WorldStreamSocket
      : null;
  // Narrowed into its own const so the hoisted `connect` below sees a
  // non-nullable factory rather than re-narrowing a captured union.
  const openSocket = opts.socketFactory ?? globalFactory;
  if (openSocket === null) return () => {};
  const factory: (url: string) => WorldStreamSocket = openSocket;

  let closed = false;
  let socket: WorldStreamSocket | null = null;
  let retryMs = WORLD_STREAM_RETRY_MS;
  let attempts = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleReconnect = () => {
    if (closed || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      if (closed) return;
      retryMs = Math.min(retryMs * 2, WORLD_STREAM_MAX_RETRY_MS);
      connect();
    }, retryMs);
  };

  function connect(): void {
    if (closed) return;
    attempts += 1;
    opts.onState(attempts === 1 ? "connecting" : "reconnecting");
    let ws: WorldStreamSocket;
    try {
      ws = factory(opts.url);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;
    ws.binaryType = "arraybuffer";
    ws.onopen = () => {
      retryMs = WORLD_STREAM_RETRY_MS;
      opts.onState("connected");
    };
    ws.onmessage = (ev) => {
      // Descriptors are binary. A text frame is off-contract; ignoring it keeps
      // a chatty proxy from being counted as a malformed descriptor.
      if (ev.data instanceof ArrayBuffer) {
        opts.onFrame(new Uint8Array(ev.data));
      } else if (ev.data instanceof Uint8Array) {
        opts.onFrame(ev.data);
      }
    };
    // `onclose` drives every reconnect, so `onerror` only has to not throw.
    ws.onerror = () => {};
    ws.onclose = () => {
      socket = null;
      if (closed) return;
      opts.onState("reconnecting");
      scheduleReconnect();
    };
  }

  connect();

  return () => {
    closed = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (socket) {
      try {
        socket.close();
      } catch {
        // a socket already closing is not an error worth propagating
      }
      socket = null;
    }
  };
}
