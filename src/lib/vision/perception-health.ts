/**
 * @module lib/vision/perception-health
 * @description Pure helpers that turn a vision-detection batch's age + the
 * node's resolved perception tier into an HONEST feed-health readout — the
 * shared logic behind the cockpit perception-health chip and the what's-locked
 * chip's "why did the lock go away" reason.
 *
 * The distinction these encode (no fabricated reading): a feed that WAS flowing and has now
 * aged past {@link DETECTION_STALE_MS} is STALE / lost — the operator cannot
 * know what the drone sees — which is a different thing from a fresh feed that
 * simply has no detections in view. A dead offload link and a silent local
 * detector are both "stale", but they get different words so the operator knows
 * whether the network dropped or the on-edge model went quiet.
 *
 * @license GPL-3.0-only
 */

import type { AgentCapabilities } from "@/lib/agent/feature-types";
import {
  DETECTION_STALE_MS,
  type VisionDetectionBatch,
} from "@/stores/vision-detections-store";

/** The resolved perception execution tier (where detection runs). */
export type PerceptionTier = NonNullable<AgentCapabilities["perceptionTier"]>;

/**
 * Feed liveness for one drone:
 *  - `idle`  — no batch ever arrived (perception not producing / "no detections
 *              yet"); NEVER conflate this with a lost feed.
 *  - `fresh` — a batch arrived within the stale window.
 *  - `stale` — a batch WAS flowing but has aged past the window (feed / offload
 *              link lost).
 */
export type PerceptionFeedState = "idle" | "fresh" | "stale";

/** Classify a drone's detection feed by the age of its latest batch. */
export function perceptionFeedState(
  batch: VisionDetectionBatch | undefined,
  now: number,
): PerceptionFeedState {
  if (!batch) return "idle";
  return now - batch.receivedAt <= DETECTION_STALE_MS ? "fresh" : "stale";
}

/**
 * The short label for a resolved tier. Returns a neutral `PERCEPTION` when the
 * tier is unknown but a feed is flowing (never fabricates a tier), and `null`
 * when there is no perception context to show at all.
 */
export function tierLabel(
  tier: PerceptionTier | "none" | undefined,
  hasFeed: boolean,
): string | null {
  switch (tier) {
    case "local":
      return "LOCAL";
    case "offload":
      return "OFFLOAD";
    case "hybrid":
      return "HYBRID";
    default:
      return hasFeed ? "PERCEPTION" : null;
  }
}

/**
 * Why a live feed went stale, tailored to where perception runs: an offloaded
 * feed going quiet is an "Offload link lost"; a local (or unknown) feed is a
 * "Perception feed stale". Only meaningful when the feed state is `stale`.
 */
export function staleReason(tier: PerceptionTier | "none" | undefined): string {
  return tier === "offload" ? "Offload link lost" : "Perception feed stale";
}

/** Rolling window (ms) the live throughput readout measures batches over. */
export const THROUGHPUT_WINDOW_MS = 3000;

/**
 * The state of a drone's perception SESSION — the long-lived open→flow→close
 * lifecycle, distinct from a one-shot "run now" job. Derived from the detection
 * feed freshness plus whether a perception tier is set:
 *  - `opening` — a perception tier is expected but no batch has arrived yet.
 *  - `live`    — batches are flowing (feed fresh).
 *  - `stalled` — a feed WAS flowing and has aged past the stale window.
 *  - `closed`  — no feed and no perception context (no session running).
 */
export type PerceptionSessionState = "opening" | "live" | "stalled" | "closed";

/** Fold a feed state + resolved tier into a session state (`stalled`
 * only when a feed had actually started; `opening` vs `closed` on an idle feed
 * turns on whether a real tier is running). */
export function perceptionSessionState(
  feed: PerceptionFeedState,
  tier: PerceptionTier | undefined,
): PerceptionSessionState {
  if (feed === "fresh") return "live";
  if (feed === "stale") return "stalled";
  // idle: expecting a session (a real tier set) vs nothing running at all.
  return tier === "local" || tier === "offload" || tier === "hybrid"
    ? "opening"
    : "closed";
}

/**
 * Live detection throughput (batches per second) over a rolling window,
 * computed from the receipt timestamps of a drone's recent batches. Returns
 * `null` when fewer than two samples fall in the window — too sparse to call a
 * rate honestly (never fabricate a rate from one sample). The value is
 * the observed arrival frequency (samples over their own span), so it is
 * accurate during warm-up and falls as samples age out of the window.
 */
export function batchesPerSecond(
  receiptTimes: readonly number[],
  now: number,
  windowMs: number,
): number | null {
  if (windowMs <= 0) return null;
  const cutoff = now - windowMs;
  let oldest = Infinity;
  let newest = -Infinity;
  let count = 0;
  for (const t of receiptTimes) {
    if (t < cutoff || t > now) continue;
    if (t < oldest) oldest = t;
    if (t > newest) newest = t;
    count += 1;
  }
  if (count < 2) return null;
  const spanMs = newest - oldest;
  if (spanMs <= 0) return null;
  return ((count - 1) / spanMs) * 1000;
}

/**
 * Where a pipeline's detection runs, derived from the node's resolved tier:
 * `local` (on the node's own accelerator), `offload` (streamed to a
 * workstation, whose address rides in `detail`), or `auto` (a hybrid node that
 * splits pipelines across both). Returns `null` when the tier is unknown / none
 * so a target badge is never fabricated (no fabricated reading).
 */
export interface ExecutionTarget {
  kind: "local" | "offload" | "auto";
  /** The offload workstation address — present only for `offload`. */
  detail?: string;
}

export function executionTarget(
  tier: PerceptionTier | undefined,
  offloadTarget: string | null | undefined,
): ExecutionTarget | null {
  switch (tier) {
    case "offload":
      return { kind: "offload", detail: offloadTarget ?? undefined };
    case "local":
      return { kind: "local" };
    case "hybrid":
      return { kind: "auto" };
    default:
      return null;
  }
}
