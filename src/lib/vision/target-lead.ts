/**
 * @module lib/vision/target-lead
 * @description Pure math for the cockpit's target-lead reticle: from a tracked
 * target's recent centre-position history, estimate its velocity and project a
 * LEAD point a fixed time ahead — where the target is heading, so a pilot (or a
 * gimbal/behaviour) aims ahead of a mover instead of chasing it.
 *
 * Honesty (no fabricated reading): a lead is returned ONLY when there is real, measurable
 * motion. Fewer than two samples, a zero-time span, or a measured speed below
 * the stationary threshold all return `null` — the reticle is simply not drawn
 * rather than inventing a heading for a still (or untracked) target.
 *
 * All quantities are in the detection frame's own pixel space, the same space
 * the boxes and marks are expressed in, so the mark layer letterbox-maps the
 * lead point exactly like a box.
 *
 * @license GPL-3.0-only
 */

/** One centre-position sample of a track at wall-clock time `t` (epoch ms). */
export interface TrackSample {
  t: number;
  cx: number;
  cy: number;
}

/** A projected lead point (frame px) plus the velocity that produced it. */
export interface LeadPoint {
  cx: number;
  cy: number;
  /** Speed in frame px/sec (>= the caller's `minSpeedPxPerSec`). */
  speedPxPerSec: number;
}

/** Default look-ahead time (ms) the reticle projects the target forward. */
export const LEAD_MS = 600;

/** How much history (ms) the velocity estimate averages over. */
export const LEAD_HISTORY_MS = 600;

/** Below this measured speed (frame px/sec) a target is treated as stationary
 * and no lead is drawn — a small camera jitter must not spawn a fake heading. */
export const MIN_LEAD_SPEED_PX_PER_SEC = 45;

/**
 * Append a sample to a bounded per-track history, dropping samples older than
 * `windowMs` relative to the newest one. Pure: returns a new array.
 */
export function pushLeadSample(
  history: readonly TrackSample[],
  sample: TrackSample,
  windowMs: number,
): TrackSample[] {
  const out: TrackSample[] = [];
  for (const s of history) {
    if (sample.t - s.t <= windowMs && s.t <= sample.t) out.push(s);
  }
  out.push(sample);
  return out;
}

/**
 * Estimate the lead point from a track's recent centre history. Velocity is the
 * first→last displacement over the window's own time span (robust to the exact
 * sample count). Returns `null` when the motion is not real enough to lead.
 */
export function computeLead(
  samples: readonly TrackSample[],
  leadMs: number,
  minSpeedPxPerSec: number,
): LeadPoint | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dtMs = last.t - first.t;
  if (dtMs <= 0) return null;

  // px per ms.
  const vx = (last.cx - first.cx) / dtMs;
  const vy = (last.cy - first.cy) / dtMs;
  const speedPxPerSec = Math.hypot(vx, vy) * 1000;
  if (speedPxPerSec < minSpeedPxPerSec) return null;

  return {
    cx: last.cx + vx * leadMs,
    cy: last.cy + vy * leadMs,
    speedPxPerSec,
  };
}
