/**
 * @module hud/follow-chrome
 * @description Pure rules behind the following-mode chrome (range panel,
 * right rail, follow skill popover): when following mode is on, the phase
 * colour, the range interval-bar geometry and the readout formats.
 *
 * @license GPL-3.0-only
 */

import type { FollowPhase, RangeCueKind } from "./nav-types";

/** HUD role a phase word is drawn in. */
export type PhaseTone = "track" | "coast" | "warn" | "crit" | "muted";

export const PHASE_TONE: Readonly<Record<FollowPhase, PhaseTone>> = {
  idle: "muted",
  acquiring: "track",
  following: "track",
  coasting: "coast",
  searching: "coast",
  holding: "warn",
  lost: "crit",
};

/** Pipeline latency above this reads as a warning (ms). */
export const LATENCY_WARN_MS = 250;

/**
 * A non-idle phase older than this no longer holds the cockpit in following
 * mode: the chrome shows STALE for a while, then steps aside.
 */
export const FOLLOW_MODE_FORGET_MS = 60_000;

/** Cue chips in panel order. */
export const RANGE_CUE_ORDER: readonly RangeCueKind[] = ["ground", "box_height", "lidar"];

export interface FollowingModeInput {
  /** Last reported phase, or null when nothing was reported. */
  phase: FollowPhase | null;
  /** Age of that report (ms). */
  ageMs: number;
  /** The follow skill is installed on this drone. */
  installed: boolean;
  /** A target is designated on this drone. */
  designated: boolean;
}

/**
 * Following mode: the follow skill reports any phase other than idle, or a
 * target is designated while the follow skill is installed.
 */
export function isFollowingMode(input: FollowingModeInput): boolean {
  if (input.phase !== null && input.phase !== "idle" && input.ageMs <= FOLLOW_MODE_FORGET_MS) {
    return true;
  }
  return input.installed && input.designated;
}

/** The interval-bar scale: `max(20, ceil5(range + 2σ))` metres. */
export function rangeScaleMax(rangeM: number, sigmaM: number | null): number {
  const hi = rangeM + 2 * Math.max(0, sigmaM ?? 0);
  return Math.max(20, Math.ceil(hi / 5) * 5);
}

export interface IntervalBar {
  maxM: number;
  /** Filled segment, as fractions of the track (null with no sigma). */
  lo: number | null;
  hi: number | null;
  /** The range tick, as a fraction of the track. */
  tick: number;
}

export function intervalBar(rangeM: number, sigmaM: number | null): IntervalBar {
  const maxM = rangeScaleMax(rangeM, sigmaM);
  const frac = (m: number) => Math.min(1, Math.max(0, m / maxM));
  if (sigmaM === null) return { maxM, lo: null, hi: null, tick: frac(rangeM) };
  return {
    maxM,
    lo: frac(rangeM - 2 * sigmaM),
    hi: frac(rangeM + 2 * sigmaM),
    tick: frac(rangeM),
  };
}

/** A true-north bearing as three digits (`064`). */
export function bearing3(deg: number): string {
  const whole = ((Math.round(deg) % 360) + 360) % 360;
  return String(whole).padStart(3, "0");
}
