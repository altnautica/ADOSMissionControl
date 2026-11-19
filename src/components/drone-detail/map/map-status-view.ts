/**
 * @module drone-detail/map/map-status-view
 * @description Formats Navigation's `map_status` payload for the Map tab's
 * status card: freshness by source, placement and pose-provider words, memory
 * fraction, the FC IMU feed and the warn/critical tones the agent's own map
 * panel uses. Pure, so the card's states are testable without a store.
 *
 * @license GPL-3.0-only
 */

import type { ImuFeedState, MapPlacement, MapStatus, PoseProvider } from "@/lib/hud/nav-types";
import type { Stamped } from "@/stores/nav-stream-store";

/** Where the status came from: the 1 Hz LAN nav stream, or the slower
 * heartbeat slice relayed through the cloud. */
export type MapStatusSource = "stream" | "heartbeat";

/** The nav stream publishes at 1 Hz, so a few missed frames mean stale. */
export const MAP_STATUS_STREAM_STALE_MS = 5_000;
/** The heartbeat slice arrives every few seconds; allow several misses. */
export const MAP_STATUS_HEARTBEAT_STALE_MS = 15_000;

/** Memory fraction thresholds shared with the agent's map panel. */
export const MAP_MEMORY_WARN = 0.85;
export const MAP_MEMORY_CRIT = 0.95;

export type MapTone = "ok" | "warn" | "crit";

/** Shared spec keys for the placement, pose-provider and IMU-feed words. */
export const PLACEMENT_KEY: Record<MapPlacement, string> = {
  onboard: "map.status.placement.onboard",
  stream: "map.status.placement.stream",
  post_flight: "map.status.placement.post_flight",
  hybrid: "map.status.placement.hybrid",
};

export const PROVIDER_KEY: Record<PoseProvider, string> = {
  lidar_planar: "map.status.pose_provider.lidar_planar",
  fc_ekf: "map.status.pose_provider.fc_ekf",
  vio: "map.status.pose_provider.vio",
  replay: "map.status.pose_provider.replay",
};

export const IMU_FEED_KEY: Record<ImuFeedState, string> = {
  ok: "map.status.imu_feed.ok",
  degraded: "map.status.imu_feed.degraded",
  lost: "map.status.imu_feed.lost",
};

export interface MapStatusView {
  state: "empty" | "stale" | "live";
  status: MapStatus | null;
  /** Whole seconds since the status arrived, or null when empty. */
  ageS: number | null;
  /** Memory used as a 0–1 fraction of the budget, or null when unknown. */
  memoryFraction: number | null;
  memoryTone: MapTone;
  imuTone: MapTone;
}

const EMPTY: MapStatusView = {
  state: "empty",
  status: null,
  ageS: null,
  memoryFraction: null,
  memoryTone: "ok",
  imuTone: "ok",
};

/** Whether a status entry is fresh for its source's cadence. */
export function mapStatusLive(
  entry: Stamped<MapStatus> | null,
  now: number,
  source: MapStatusSource,
): boolean {
  if (!entry) return false;
  const budget = source === "stream" ? MAP_STATUS_STREAM_STALE_MS : MAP_STATUS_HEARTBEAT_STALE_MS;
  return Math.max(0, now - entry.receivedAt) <= budget;
}

export function mapStatusView(
  entry: Stamped<MapStatus> | null,
  now: number,
  source: MapStatusSource = "stream",
): MapStatusView {
  if (!entry) return EMPTY;
  const s = entry.data;
  const memoryFraction =
    s.memoryUsedMb !== null && s.memoryBudgetMb !== null && s.memoryBudgetMb > 0
      ? Math.min(1, Math.max(0, s.memoryUsedMb / s.memoryBudgetMb))
      : null;
  const ageMs = Math.max(0, now - entry.receivedAt);
  return {
    state: mapStatusLive(entry, now, source) ? "live" : "stale",
    status: s,
    ageS: Math.floor(ageMs / 1000),
    memoryFraction,
    memoryTone:
      memoryFraction === null
        ? "ok"
        : memoryFraction >= MAP_MEMORY_CRIT
          ? "crit"
          : memoryFraction >= MAP_MEMORY_WARN
            ? "warn"
            : "ok",
    imuTone: s.imuFeed?.state === "lost" ? "crit" : s.imuFeed?.state === "degraded" ? "warn" : "ok",
  };
}
