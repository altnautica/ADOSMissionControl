/**
 * @module video/frame-age
 * @description How old the frame currently on screen is, and which estimator
 * said so.
 *
 * ## Why this exists
 *
 * Every overlay the cockpit composites over the video — the artificial
 * horizon, the speed and altitude tapes, the detection boxes, the plugin
 * `video.overlay` payload — used to read telemetry at *telemetry* time and
 * paint it over a frame captured 180-240 ms earlier. At 15 m/s that is ~3.5 m
 * of position error, and during a roll the horizon is visibly out of phase
 * with the picture behind it: the classic FPV desync that induces
 * pilot-induced oscillation. The operator has no way to know, because nothing
 * on the surface stated the skew.
 *
 * Two fixes need the same number, so the number lives here once:
 *
 * 1. Make the skew visible — the cockpit renders the age as an explicit
 *    qualified chip, never an unlabelled "ms".
 * 2. Make the overlays honest — each looks up the telemetry sample that was
 *    true at `now - ageMs` instead of the newest one, so the overlay travels
 *    with its frame.
 *
 * ## The estimators, in preference order
 *
 * - `sei-g2g` — `useVideoStore.latency.trueG2GMs`, the SEI probe's measured
 *   camera-capture-to-presented-frame delay. The only estimator that can see
 *   the camera and encode legs, because they are upstream of every timestamp
 *   the browser has. Needs `RTCRtpScriptTransform` in the browser and SEI
 *   injection enabled on the agent.
 * - `frame-metadata` — `getLatencyBudget().hops.endToEnd.p50Ms`, derived from
 *   the `requestVideoFrameCallback` metadata the user agent supplies. Works
 *   with no agent cooperation, but its `captureTime` is the RTCP-synchronised
 *   *sender* capture instant, so it covers network, decode and composite and
 *   NOT the camera or encoder. It therefore UNDERSTATES the true age, which
 *   is why it is the fallback and why it is labelled differently.
 * - `null` — neither is available. Surfaces render an explicit unknown state
 *   and align to the newest sample; they never substitute a plausible
 *   constant, because a wrong alignment offset is indistinguishable from a
 *   correct one on screen.
 *
 * @license GPL-3.0-only
 */

import { getLatencyBudget } from "./latency-budget";

/** Which estimator produced a frame age. */
export type FrameAgeSource = "sei-g2g" | "frame-metadata";

/** The age of the frame on screen, with its provenance. */
export interface FrameAge {
  /** Milliseconds from camera capture to the frame being presented. */
  ms: number;
  source: FrameAgeSource;
}

/**
 * Upper bound on an age this module will report.
 *
 * Above a second and a half the estimate is describing a clock disagreement
 * or a stalled session rather than a pipeline delay, and using it as an
 * alignment offset would reach past the end of every telemetry ring buffer.
 * Reporting no age is honest; reporting a two-second offset is not.
 */
const MAX_REPORTABLE_AGE_MS = 1_500;

function usable(ms: number | null | undefined): boolean {
  return (
    typeof ms === "number" &&
    Number.isFinite(ms) &&
    ms > 0 &&
    ms <= MAX_REPORTABLE_AGE_MS
  );
}

/**
 * Resolve the frame age from the two estimators, or `null` when neither has
 * produced a usable figure.
 *
 * Pure, and takes both inputs as parameters: the caller owns the
 * subscriptions (a Zustand selector for the SEI figure, `getLatencyBudget`
 * for the metadata one), and this stays testable without either.
 *
 * @param trueG2GMs — `useVideoStore.latency.trueG2GMs`
 * @param endToEndP50Ms — `getLatencyBudget().hops?.endToEnd.p50Ms`
 */
export function resolveFrameAge(
  trueG2GMs: number | null | undefined,
  endToEndP50Ms: number | null | undefined,
): FrameAge | null {
  if (usable(trueG2GMs)) {
    return { ms: trueG2GMs as number, source: "sei-g2g" };
  }
  if (usable(endToEndP50Ms)) {
    return { ms: endToEndP50Ms as number, source: "frame-metadata" };
  }
  return null;
}

/**
 * The end-to-end P50 the frame-metadata estimator currently reports, or
 * `null` when no frame has carried usable timestamps yet.
 *
 * `hops` is absent until the first sample lands, and `samples === 0` means
 * the percentiles are zeros rather than measurements.
 */
export function frameMetadataEndToEndMs(): number | null {
  const budget = getLatencyBudget();
  if (budget.samples === 0 || !budget.hops) return null;
  return budget.hops.endToEnd.p50Ms;
}

/** Short provenance suffix for a readout, so no figure is ever bare "ms". */
export function frameAgeLabel(age: FrameAge | null): string {
  if (!age) return "—";
  return age.source === "sei-g2g"
    ? `${Math.round(age.ms)} ms G2G`
    : `${Math.round(age.ms)} ms e2e`;
}
