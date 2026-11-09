/**
 * @module nav-stream-store
 * @description Per-drone latest navigation feed: the follow-me state and its
 * last discrete event, the vision-nav state, the world-engine pose, scan and
 * map status, the SLAM trail and the live occupancy grid. Fed by the agent's
 * `WS /api/v1/nav/stream` and `GET /api/v1/map/live` (`lib/agent/nav-stream`)
 * or by the demo generator; read by the HUD, the minimap, the radar and the
 * node-detail Map tab.
 *
 * Every entry carries `receivedAt` (this browser's clock) so each surface can
 * apply its own staleness rule; nothing here decides freshness.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

import type {
  FollowEvent,
  FollowState,
  MapStatus,
  NavPose,
  NavScan,
  NavState,
  OccupancyLive,
} from "@/lib/hud/nav-types";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import {
  EMPTY_OCCUPANCY,
  appendTrail,
  mergeOccupancy,
  type OccupancyGrid,
  type TrailPoint,
} from "@/lib/hud/local-frame";

/** HUD staleness rules, shared by every reader. */
export const FOLLOW_STALE_MS = 2000;
export const NAV_STATE_STALE_MS = 2000;
export const SCAN_STALE_MS = 500;
export const POSE_STALE_MS = 500;
export const OCCUPANCY_DIM_MS = 5000;
/** The flight-state chip dims and reads LINK after this (cockpit spec). */
export const PILOT_STALE_MS = 2000;

export interface Stamped<T> {
  data: T;
  /** Browser clock (ms) when the frame arrived. */
  receivedAt: number;
}

export interface DroneNavFeed {
  follow?: Stamped<FollowState>;
  followEvent?: Stamped<FollowEvent>;
  nav?: Stamped<NavState>;
  pose?: Stamped<NavPose>;
  scan?: Stamped<NavScan>;
  map?: Stamped<MapStatus>;
  /** ADOS Pilot state (`pilot` kind, 10 Hz). */
  pilot?: Stamped<PilotState>;
  trail: TrailPoint[];
  occupancy: OccupancyGrid;
  /** Browser clock (ms) of the last successful `map/live` poll, or null. */
  occupancyPolledAt: number | null;
  /** How the feed arrives: the live stream, the 2 Hz `nav/status` fallback
   * poll (reduced rate, e.g. a ground-station radio relay), or not yet known. */
  transport?: "stream" | "poll" | null;
}

const EMPTY_FEED: DroneNavFeed = { trail: [], occupancy: EMPTY_OCCUPANCY, occupancyPolledAt: null };

interface NavStreamState {
  byDrone: Record<string, DroneNavFeed>;
  setFollow: (droneId: string, data: FollowState, at?: number) => void;
  pushFollowEvent: (droneId: string, data: FollowEvent, at?: number) => void;
  setNav: (droneId: string, data: NavState, at?: number) => void;
  setPose: (droneId: string, data: NavPose, at?: number) => void;
  setScan: (droneId: string, data: NavScan, at?: number) => void;
  setMap: (droneId: string, data: MapStatus, at?: number) => void;
  setPilot: (droneId: string, data: PilotState, at?: number) => void;
  mergeOccupancy: (droneId: string, live: OccupancyLive, at?: number) => void;
  setTransport: (droneId: string, transport: "stream" | "poll" | null) => void;
  clear: (droneId: string) => void;
}

function patch(
  state: NavStreamState,
  droneId: string,
  fn: (feed: DroneNavFeed) => Partial<DroneNavFeed>,
): Pick<NavStreamState, "byDrone"> {
  const feed = state.byDrone[droneId] ?? EMPTY_FEED;
  return { byDrone: { ...state.byDrone, [droneId]: { ...feed, ...fn(feed) } } };
}

export const useNavStreamStore = create<NavStreamState>()((set) => ({
  byDrone: {},
  setFollow: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ follow: { data, receivedAt: at } }))),
  pushFollowEvent: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ followEvent: { data, receivedAt: at } }))),
  setNav: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ nav: { data, receivedAt: at } }))),
  setPose: (droneId, data, at = Date.now()) =>
    set((s) =>
      patch(s, droneId, (feed) => ({
        pose: { data, receivedAt: at },
        trail: appendTrail(feed.trail, { x: data.t[0], y: data.t[1], at, health: data.health }),
      })),
    ),
  setScan: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ scan: { data, receivedAt: at } }))),
  setMap: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ map: { data, receivedAt: at } }))),
  setPilot: (droneId, data, at = Date.now()) =>
    set((s) => patch(s, droneId, () => ({ pilot: { data, receivedAt: at } }))),
  mergeOccupancy: (droneId, live, at = Date.now()) =>
    set((s) =>
      patch(s, droneId, (feed) => ({
        occupancy: mergeOccupancy(feed.occupancy, live),
        occupancyPolledAt: at,
      })),
    ),
  setTransport: (droneId, transport) =>
    set((s) =>
      (s.byDrone[droneId]?.transport ?? null) === transport
        ? s
        : patch(s, droneId, () => ({ transport })),
    ),
  clear: (droneId) =>
    set((s) => {
      if (!(droneId in s.byDrone)) return s;
      const byDrone = { ...s.byDrone };
      delete byDrone[droneId];
      return { byDrone };
    }),
}));

/** Selector for one drone's feed (undefined until the first frame). */
export function selectNavFeed(droneId: string | null | undefined) {
  return (s: NavStreamState): DroneNavFeed | undefined =>
    droneId ? s.byDrone[droneId] : undefined;
}

/** `entry.data` when it is younger than `maxAgeMs` at `now`, else null. */
export function freshData<T>(
  entry: Stamped<T> | undefined,
  now: number,
  maxAgeMs: number,
): T | null {
  return entry && now - entry.receivedAt <= maxAgeMs ? entry.data : null;
}
