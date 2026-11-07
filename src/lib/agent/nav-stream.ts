/**
 * @module nav-stream
 * @description Live navigation feed for one drone. Opens the agent's
 * `WS /api/v1/nav/stream` (ticket scope `nav.stream`, minted the same way as
 * the detection stream so the pairing key never reaches the URL), parses each
 * frame and feeds the nav-stream store; and polls `GET /api/v1/map/live` at
 * 1 Hz for changed occupancy tiles, carrying the last `seq` forward.
 *
 * Frames: `{kind: "pose"|"scan"|"nav"|"follow"|"map", ts_ms, data}` carry the
 * source payload verbatim; `{kind: "follow_event", topic, data}` carries a
 * discrete `follow.reacquired` / `follow.lost`; `{kind: "keepalive"}` is
 * consumed by the socket loop.
 *
 * @license GPL-3.0-only
 */

import { gsRequest, type RequestContext } from "@/lib/api/ground-station/request";
import { subscribeWebSocket } from "@/lib/api/ground-station/ws";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import {
  parseArFrame,
  parseDepthFrame,
  parseObstaclesFrame,
  parsePilotState,
  parseSurfacesFrame,
  type ArFrame,
  type DepthFrame,
  type ObstaclesFrame,
  type PilotState,
  type SurfacesFrame,
} from "@/lib/cockpit/layers/cockpit-frames";
import { clearFrames, putFrame } from "@/lib/cockpit/layers/frame-store";
import { setViewLeaseSender, viewDemand } from "@/lib/cockpit/layers/view-lease";

import {
  parseFollowEvent,
  parseFollowState,
  parseMapStatus,
  parseNavPose,
  parseNavScan,
  parseNavState,
  parseOccupancyLive,
  type FollowEvent,
  type FollowState,
  type MapStatus,
  type NavPose,
  type NavScan,
  type NavState,
} from "./nav-types";

export type NavFrame =
  | { kind: "pose"; data: NavPose }
  | { kind: "scan"; data: NavScan }
  | { kind: "nav"; data: NavState }
  | { kind: "follow"; data: FollowState }
  | { kind: "map"; data: MapStatus }
  | { kind: "follow_event"; data: FollowEvent }
  | { kind: "pilot"; data: PilotState }
  | { kind: "obstacles"; data: ObstaclesFrame }
  | { kind: "ar"; data: ArFrame }
  | { kind: "depth"; data: DepthFrame }
  | { kind: "surfaces"; data: SurfacesFrame };

/** Parse one nav-stream frame; null for keepalives, unknown kinds and
 * malformed payloads. */
export function parseNavFrame(raw: unknown): NavFrame | null {
  if (typeof raw !== "object" || raw === null) return null;
  const f = raw as { kind?: unknown; data?: unknown; topic?: unknown };
  switch (f.kind) {
    case "pose": {
      const data = parseNavPose(f.data);
      return data ? { kind: "pose", data } : null;
    }
    case "scan": {
      const data = parseNavScan(f.data);
      return data ? { kind: "scan", data } : null;
    }
    case "nav": {
      const data = parseNavState(f.data);
      return data ? { kind: "nav", data } : null;
    }
    case "follow": {
      const data = parseFollowState(f.data);
      return data ? { kind: "follow", data } : null;
    }
    case "map": {
      const data = parseMapStatus(f.data);
      return data ? { kind: "map", data } : null;
    }
    case "follow_event": {
      const data = parseFollowEvent(f.topic, f.data);
      return data ? { kind: "follow_event", data } : null;
    }
    case "pilot": {
      const data = parsePilotState(f.data);
      return data ? { kind: "pilot", data } : null;
    }
    case "obstacles": {
      const data = parseObstaclesFrame(f.data);
      return data ? { kind: "obstacles", data } : null;
    }
    case "ar": {
      const data = parseArFrame(f.data);
      return data ? { kind: "ar", data } : null;
    }
    case "depth": {
      const data = parseDepthFrame(f.data);
      return data ? { kind: "depth", data } : null;
    }
    case "surfaces": {
      const data = parseSurfacesFrame(f.data);
      return data ? { kind: "surfaces", data } : null;
    }
    default:
      return null;
  }
}

/** Store one parsed frame for `droneId`. The overlay frames (`ar`,
 * `obstacles`, `depth`, `surfaces`) go to the layer stack's mutable frame
 * store, never to React state; the rest to the nav-stream store. */
export function ingestNavFrame(droneId: string, frame: NavFrame, at: number = Date.now()): void {
  const s = useNavStreamStore.getState();
  switch (frame.kind) {
    case "pose":
      s.setPose(droneId, frame.data, at);
      break;
    case "scan":
      s.setScan(droneId, frame.data, at);
      break;
    case "nav":
      s.setNav(droneId, frame.data, at);
      break;
    case "follow":
      s.setFollow(droneId, frame.data, at);
      break;
    case "map":
      s.setMap(droneId, frame.data, at);
      break;
    case "follow_event":
      s.pushFollowEvent(droneId, frame.data, at);
      break;
    case "pilot":
      s.setPilot(droneId, frame.data, at);
      break;
    case "obstacles":
    case "ar":
    case "depth":
    case "surfaces":
      putFrame(droneId, frame.kind, frame.data, at);
      break;
  }
}

/** Interval of the occupancy poll. */
export const MAP_LIVE_POLL_MS = 1000;
/** Interval of the `GET /api/v1/nav/status` fallback poll (2 Hz). */
export const NAV_STATUS_POLL_MS = 500;
/** How long the stream may stay down before the status poll takes over. */
export const NAV_STREAM_FALLBACK_MS = 5000;

/** The `?view=` query for the drone's main view lease
 * (`<camera_id>:<layer,…>`), or null when nothing is leased. */
export function navStatusViewQuery(droneId: string): string | null {
  for (const [cam, layers] of viewDemand(droneId)) {
    return `${cam}:${layers.join(",")}`;
  }
  return null;
}

/**
 * One fallback poll of `GET /api/v1/nav/status`: every kind present is
 * ingested as if it had arrived on the stream, stamped with its age on the
 * drone (`age_ms`) so a stale value never reads as fresh. The `?view=` query
 * carries the view lease, so the drone computes the same overlays it would
 * for a stream client. Resolves false on any failure.
 */
export async function pollNavStatus(
  ctx: RequestContext,
  droneId: string,
  signal?: AbortSignal,
  now: () => number = Date.now,
): Promise<boolean> {
  const view = navStatusViewQuery(droneId);
  const path = view ? `/api/v1/nav/status?view=${encodeURIComponent(view)}` : "/api/v1/nav/status";
  try {
    const raw = await gsRequest<unknown>(ctx, path, { signal });
    if (typeof raw !== "object" || raw === null) return false;
    for (const [kind, entry] of Object.entries(raw as Record<string, unknown>)) {
      if (kind === "view_demand" || typeof entry !== "object" || entry === null) continue;
      const e = entry as { ts_ms?: unknown; age_ms?: unknown; data?: unknown };
      const frame = parseNavFrame({ kind, ts_ms: e.ts_ms, data: e.data });
      if (!frame) continue;
      const age = typeof e.age_ms === "number" && e.age_ms >= 0 ? e.age_ms : 0;
      ingestNavFrame(droneId, frame, now() - age);
    }
    return true;
  } catch {
    return false;
  }
}

export interface ConnectNavStreamOptions {
  droneId: string;
  /** LAN base URL of the drone's agent. */
  agentUrl: string;
  apiKey: string | null;
  onState?: (state: "connected" | "reconnecting" | "closed") => void;
}

export interface NavStreamConnection {
  /** Close the socket, stop the occupancy poll and clear the drone's feed. */
  close: () => void;
}

/** Fetch occupancy tiles changed since `since` and merge them into the store.
 * Resolves false on any failure (the next poll retries). */
export async function pollMapLive(
  ctx: RequestContext,
  droneId: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const since = useNavStreamStore.getState().byDrone[droneId]?.occupancy.seq ?? 0;
  try {
    const raw = await gsRequest<unknown>(ctx, `/api/v1/map/live?since=${since}`, { signal });
    const live = parseOccupancyLive(raw);
    if (!live) return false;
    useNavStreamStore.getState().mergeOccupancy(droneId, live);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the nav stream and the occupancy poll for one drone. A null/empty
 * `agentUrl` (no LAN path) returns a closeable no-op handle.
 */
export function connectNavStream(opts: ConnectNavStreamOptions): NavStreamConnection {
  const { droneId, agentUrl, apiKey, onState } = opts;
  if (!agentUrl) return { close: () => {} };
  const ctx: RequestContext = { baseUrl: agentUrl, apiKey };
  const store = useNavStreamStore.getState;

  // When the stream was last connected (or the connection started): the
  // status poll takes over once it has been down NAV_STREAM_FALLBACK_MS.
  let streamUp = false;
  let downSince = Date.now();

  const unsubscribe = subscribeWebSocket<unknown>({
    ctx,
    path: "/api/v1/nav/stream",
    scope: "nav.stream",
    onEvent: (raw) => {
      const frame = parseNavFrame(raw);
      if (frame) ingestNavFrame(droneId, frame);
    },
    // The handler sends `{kind:"keepalive"}` every 5 s.
    peerSendsKeepalive: true,
    onState: (state) => {
      if (state !== "connected") setViewLeaseSender(droneId, null);
      if (state === "connected") {
        streamUp = true;
        store().setTransport(droneId, "stream");
      } else if (streamUp) {
        streamUp = false;
        downSince = Date.now();
      }
      onState?.(state);
    },
    // Every (re)opened socket gets the current view leases at once.
    onOpen: (send) => setViewLeaseSender(droneId, send),
  });

  let closed = false;
  let mapInFlight: AbortController | null = null;
  let navInFlight: AbortController | null = null;
  let lastMapPoll = 0;
  const timer = setInterval(() => {
    if (closed) return;
    const now = Date.now();
    if (!mapInFlight && now - lastMapPoll >= MAP_LIVE_POLL_MS) {
      lastMapPoll = now;
      mapInFlight = new AbortController();
      void pollMapLive(ctx, droneId, mapInFlight.signal).finally(() => {
        mapInFlight = null;
      });
    }
    // Reduced-rate fallback: the stream did not come up (or dropped) but the
    // HTTP path may still answer, e.g. a ground-station radio relay.
    if (!streamUp && now - downSince >= NAV_STREAM_FALLBACK_MS && !navInFlight) {
      navInFlight = new AbortController();
      void pollNavStatus(ctx, droneId, navInFlight.signal)
        .then((ok) => {
          if (!closed && !streamUp) store().setTransport(droneId, ok ? "poll" : null);
        })
        .finally(() => {
          navInFlight = null;
        });
    }
  }, NAV_STATUS_POLL_MS);

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
      mapInFlight?.abort();
      navInFlight?.abort();
      unsubscribe();
      useNavStreamStore.getState().clear(droneId);
      setViewLeaseSender(droneId, null);
      clearFrames(droneId);
    },
  };
}
