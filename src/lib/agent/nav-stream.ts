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
  | { kind: "follow_event"; data: FollowEvent };

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
    default:
      return null;
  }
}

/** Store one parsed frame for `droneId`. */
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
  }
}

/** Interval of the occupancy poll. */
export const MAP_LIVE_POLL_MS = 1000;

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
    onState,
  });

  let closed = false;
  let inFlight: AbortController | null = null;
  const timer = setInterval(() => {
    if (closed || inFlight) return;
    inFlight = new AbortController();
    void pollMapLive(ctx, droneId, inFlight.signal).finally(() => {
      inFlight = null;
    });
  }, MAP_LIVE_POLL_MS);

  return {
    close: () => {
      closed = true;
      clearInterval(timer);
      inFlight?.abort();
      unsubscribe();
      useNavStreamStore.getState().clear(droneId);
    },
  };
}
