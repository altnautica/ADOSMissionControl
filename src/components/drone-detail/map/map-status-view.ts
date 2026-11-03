/**
 * @module drone-detail/map/map-status-view
 * @description Formats the world-engine `map_status` payload for the Map
 * tab's status card: freshness, placement word, memory fraction, upload
 * progress and stream rate. Pure, so the card's states are testable without
 * a store.
 *
 * @license GPL-3.0-only
 */

import type { MapPlacement, MapStatus, StreamState, UploadState } from "@/lib/agent/nav-types";
import type { Stamped } from "@/stores/nav-stream-store";
import { formatBytes } from "@/lib/tile-math";

/** Map status is published at 1 Hz on the nav stream; the heartbeat slice
 * fallback arrives every few seconds, so the card allows several misses. */
export const MAP_STATUS_STALE_MS = 15_000;

export const PLACEMENT_KEY: Record<MapPlacement, string> = {
  onboard: "placementOnboard",
  stream: "placementStream",
  post_flight: "placementPostFlight",
  hybrid: "placementHybrid",
};

export const UPLOAD_KEY: Record<UploadState, string> = {
  idle: "uploadIdle",
  queued: "uploadQueued",
  uploading: "uploadUploading",
  done: "uploadDone",
  failed: "uploadFailed",
};

export const STREAM_KEY: Record<StreamState, string> = {
  off: "streamOff",
  connecting: "streamConnecting",
  live: "streamLive",
  degraded: "streamDegraded",
};

export interface MapStatusView {
  state: "empty" | "stale" | "live";
  status: MapStatus | null;
  /** Memory used as a 0–1 fraction of the budget, or null when unknown. */
  memoryFraction: number | null;
  uploadPct: number | null;
  streamRate: string | null;
}

export function mapStatusView(entry: Stamped<MapStatus> | null, now: number): MapStatusView {
  if (!entry) return { state: "empty", status: null, memoryFraction: null, uploadPct: null, streamRate: null };
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
  return {
    state: now - entry.receivedAt > MAP_STATUS_STALE_MS ? "stale" : "live",
    status: s,
    memoryFraction,
    uploadPct,
    streamRate: s.stream ? `${formatBytes(Math.max(0, Math.round(s.stream.bytesPerS)))}/s` : null,
  };
}
