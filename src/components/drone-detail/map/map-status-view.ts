/**
 * @module drone-detail/map/map-status-view
 * @description Formats the world-engine `map_status` payload for the Map
 * tab's status card: freshness by source, placement word, memory fraction,
 * upload progress, stream rate and the warn/critical tones the agent's own
 * map panel uses. Pure, so the card's states are testable without a store.
 *
 * @license GPL-3.0-only
 */

import type { MapPlacement, MapStatus, StreamState, UploadState } from "@/lib/hud/nav-types";
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

/** Shared spec keys for the placement, upload and stream words. */
export const PLACEMENT_KEY: Record<MapPlacement, string> = {
  onboard: "map.status.placement.onboard",
  stream: "map.status.placement.stream",
  post_flight: "map.status.placement.post_flight",
  hybrid: "map.status.placement.hybrid",
};

export const UPLOAD_KEY: Record<UploadState, string> = {
  idle: "map.status.upload.idle",
  queued: "map.status.upload.queued",
  uploading: "map.status.upload.uploading",
  done: "map.status.upload.done",
  failed: "map.status.upload.failed",
};

export const STREAM_KEY: Record<StreamState, string> = {
  off: "map.status.stream.off",
  connecting: "map.status.stream.connecting",
  live: "map.status.stream.live",
  degraded: "map.status.stream.degraded",
};

export interface MapStatusView {
  state: "empty" | "stale" | "live";
  status: MapStatus | null;
  /** Whole seconds since the status arrived, or null when empty. */
  ageS: number | null;
  /** Memory used as a 0–1 fraction of the budget, or null when unknown. */
  memoryFraction: number | null;
  memoryTone: MapTone;
  keyframesTone: MapTone;
  uploadTone: MapTone;
  streamTone: MapTone;
  uploadPct: number | null;
  /** Stream rate in Mbit/s, one decimal, or null with no stream. */
  streamRate: string | null;
}

const EMPTY: MapStatusView = {
  state: "empty",
  status: null,
  ageS: null,
  memoryFraction: null,
  memoryTone: "ok",
  keyframesTone: "ok",
  uploadTone: "ok",
  streamTone: "ok",
  uploadPct: null,
  streamRate: null,
};

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
  const uploadPct =
    s.upload && s.upload.bytesTotal > 0
      ? Math.min(100, Math.round((s.upload.bytesDone / s.upload.bytesTotal) * 100))
      : s.upload
        ? 0
        : null;
  const ageMs = Math.max(0, now - entry.receivedAt);
  const budget = source === "stream" ? MAP_STATUS_STREAM_STALE_MS : MAP_STATUS_HEARTBEAT_STALE_MS;
  return {
    state: ageMs > budget ? "stale" : "live",
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
    keyframesTone: (s.keyframesDropped ?? 0) > 0 ? "warn" : "ok",
    uploadTone: s.upload?.state === "failed" ? "crit" : "ok",
    streamTone: s.stream?.state === "degraded" ? "warn" : "ok",
    uploadPct,
    streamRate: s.stream
      ? `${((Math.max(0, s.stream.bytesPerS) * 8) / 1_000_000).toFixed(1)} Mbit/s`
      : null,
  };
}
