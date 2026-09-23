/**
 * Step response extraction and analysis for PID tuning.
 *
 * Detects step events in desired vs actual rate data, then measures
 * rise time, overshoot, settling time, and damping ratio.
 *
 * @license GPL-3.0-only
 */

import type { TimeSample, StepResponseEvent } from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum desired rate change (deg/s) to qualify as a step event. */
const MIN_STEP_SIZE = 50;

/** Maximum time window (ms) for the initial rate change to occur. */
const STEP_DETECT_WINDOW_MS = 50;

/** Window duration after step start to analyze the response (ms). */
const ANALYSIS_WINDOW_MS = 500;

/** Rise time measured from 10% to 90% of step target. */
const RISE_LOW = 0.1;
const RISE_HIGH = 0.9;

/** Settling band: within 5% of target. */
const SETTLING_BAND = 0.05;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Convert microseconds delta to milliseconds. */
function usToMs(us: number): number {
  return us / 1000;
}

/**
 * Find the nearest sample in `series` to the given timestamp.
 * Uses binary search for performance on sorted time series.
 */
function nearestSample(series: TimeSample[], targetUs: number): number {
  let lo = 0;
  let hi = series.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].timeUs < targetUs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  // Check neighbors
  if (lo > 0) {
    const dPrev = Math.abs(series[lo - 1].timeUs - targetUs);
    const dCurr = Math.abs(series[lo].timeUs - targetUs);
    if (dPrev < dCurr) return lo - 1;
  }
  return lo;
}

/**
 * Extract a time-window slice from a sorted time series.
 * Returns samples from startUs to endUs (inclusive bounds, nearest match).
 */
function sliceSeries(
  series: TimeSample[],
  startUs: number,
  endUs: number,
): TimeSample[] {
  const startIdx = nearestSample(series, startUs);
  const endIdx = nearestSample(series, endUs);
  return series.slice(startIdx, endIdx + 1);
}

/**
 * Estimate damping ratio using the log decrement method.
 * If overshoot <= 0, estimate from settling time ratio instead.
 */
function estimateDampingRatio(
  overshootFraction: number,
  riseTimeMs: number,
  settlingTimeMs: number,
): number {
  if (overshootFraction > 0) {
    // Log decrement: zeta = -ln(overshoot) / sqrt(pi^2 + ln(overshoot)^2)
    const lnOs = Math.log(overshootFraction);
    const zeta = -lnOs / Math.sqrt(Math.PI * Math.PI + lnOs * lnOs);
    return Math.min(Math.max(zeta, 0), 2);
  }

  // No overshoot: overdamped or critically damped
  // Rough estimate from settling/rise ratio (higher ratio = more overdamped)
  if (riseTimeMs > 0 && settlingTimeMs > 0) {
    const ratio = settlingTimeMs / riseTimeMs;
    if (ratio < 2) return 1.0; // critically damped
    if (ratio < 4) return 1.2;
    return 1.5;
  }

  return 1.0; // default critically damped
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Index of the first sample at or after `tUs`, or `series.length` if none. */
function firstAtOrAfter(series: TimeSample[], tUs: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].timeUs < tUs) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Longest span the detection window may stretch to when the log has no sample
 * exactly STEP_DETECT_WINDOW_MS later. Covers RATE logged at 5 Hz or faster;
 * a longer gap is a logging dropout, not a step.
 */
const MAX_DETECT_SPAN_US = 4 * STEP_DETECT_WINDOW_MS * 1000;

/**
 * Extract step response events from desired and actual rate time series.
 *
 * A step event is detected when the desired rate changes by more than
 * `MIN_STEP_SIZE` deg/s within `STEP_DETECT_WINDOW_MS` milliseconds. The
 * autopilot limits how fast the desired rate may change, so a stick step
 * arrives as a ramp over many samples: the event is anchored where that ramp
 * starts and its target is where the ramp ends.
 */
export function extractStepResponses(
  desired: TimeSample[],
  actual: TimeSample[],
  axis: "roll" | "pitch" | "yaw",
): StepResponseEvent[] {
  if (desired.length < 10 || actual.length < 10) return [];

  const events: StepResponseEvent[] = [];
  const detectWindowUs = STEP_DETECT_WINDOW_MS * 1000;
  const analysisWindowUs = ANALYSIS_WINDOW_MS * 1000;

  // Minimum gap between detected steps (avoid double-detection)
  const minGapUs = analysisWindowUs;
  let lastStepUs = -Infinity;

  for (let i = 0; i < desired.length - 1; i++) {
    const curr = desired[i];
    if (curr.timeUs - lastStepUs < minGapUs) continue;

    const j = firstAtOrAfter(desired, curr.timeUs + detectWindowUs);
    if (j >= desired.length) break;
    if (desired[j].timeUs - curr.timeUs > MAX_DETECT_SPAN_US) continue;

    const change = desired[j].value - curr.value;
    if (Math.abs(change) < MIN_STEP_SIZE) continue;
    const dir = Math.sign(change);
    const moves = (k: number) => (desired[k + 1].value - desired[k].value) * dir > 0;

    // Ramp start: the sample before the desired rate starts moving toward the
    // new value, including any part of the ramp already under way at i.
    let start = i;
    while (start < j && !moves(start)) start++;
    while (
      start > 0 &&
      moves(start - 1) &&
      desired[start - 1].timeUs > lastStepUs + minGapUs &&
      curr.timeUs - desired[start - 1].timeUs < analysisWindowUs
    ) {
      start--;
    }
    // Ramp end: where the desired rate stops moving toward the new value.
    let end = Math.max(j, start + 1);
    while (
      end + 1 < desired.length &&
      moves(end) &&
      desired[end + 1].timeUs - desired[start].timeUs <= analysisWindowUs
    ) {
      end++;
    }

    const preStepValue = desired[start].value;
    const stepTarget = desired[end].value;
    const stepMagnitude = stepTarget - preStepValue;
    if (Math.abs(stepMagnitude) < MIN_STEP_SIZE) continue;

    const windowStartUs = desired[start].timeUs;
    const windowEndUs = windowStartUs + analysisWindowUs;
    lastStepUs = windowStartUs;

    const desiredSlice = sliceSeries(desired, windowStartUs, windowEndUs);
    const actualSlice = sliceSeries(actual, windowStartUs, windowEndUs);

    if (desiredSlice.length < 3 || actualSlice.length < 3) continue;

    // Measure rise time (10% to 90% of step target relative to pre-step)
    const threshold10 = preStepValue + stepMagnitude * RISE_LOW;
    const threshold90 = preStepValue + stepMagnitude * RISE_HIGH;

    let riseStartUs = windowStartUs;
    let riseEndUs = windowStartUs;
    let foundRiseStart = false;
    let foundRiseEnd = false;

    for (const s of actualSlice) {
      if (!foundRiseStart) {
        if (
          (stepMagnitude > 0 && s.value >= threshold10) ||
          (stepMagnitude < 0 && s.value <= threshold10)
        ) {
          riseStartUs = s.timeUs;
          foundRiseStart = true;
        }
      }
      if (foundRiseStart && !foundRiseEnd) {
        if (
          (stepMagnitude > 0 && s.value >= threshold90) ||
          (stepMagnitude < 0 && s.value <= threshold90)
        ) {
          riseEndUs = s.timeUs;
          foundRiseEnd = true;
        }
      }
    }

    const riseTimeMs = foundRiseEnd ? usToMs(riseEndUs - riseStartUs) : usToMs(analysisWindowUs);

    // Peak actual value in the step direction
    let peakValue = preStepValue;
    for (const s of actualSlice) {
      if (stepMagnitude > 0) {
        if (s.value > peakValue) peakValue = s.value;
      } else {
        if (s.value < peakValue) peakValue = s.value;
      }
    }

    // Signed excursion past the target along the step direction: positive
    // means the response went beyond the target (overshoot), negative means
    // it never reached it (undershoot).
    const excursionPercent =
      (((peakValue - stepTarget) * Math.sign(stepMagnitude)) / Math.abs(stepMagnitude)) * 100;
    const overshootPercent = Math.max(0, excursionPercent);
    const undershootPercent = Math.max(0, -excursionPercent);

    // Measure settling time: time until actual stays within 5% of target
    const settlingBand = Math.abs(stepMagnitude) * SETTLING_BAND;
    let settlingTimeUs = analysisWindowUs;

    // Walk backwards from end to find last excursion outside settling band
    for (let j = actualSlice.length - 1; j >= 0; j--) {
      if (Math.abs(actualSlice[j].value - stepTarget) > settlingBand) {
        if (j < actualSlice.length - 1) {
          settlingTimeUs = actualSlice[j + 1].timeUs - windowStartUs;
        }
        break;
      }
    }

    const settlingTimeMs = usToMs(settlingTimeUs);

    // Damping ratio
    const overshootFraction = overshootPercent / 100;
    const dampingRatio = estimateDampingRatio(
      overshootFraction,
      riseTimeMs,
      settlingTimeMs,
    );

    const durationMs = usToMs(
      (desiredSlice[desiredSlice.length - 1]?.timeUs ?? windowEndUs) -
        windowStartUs,
    );

    events.push({
      startTimeUs: windowStartUs,
      durationMs,
      axis,
      riseTimeMs,
      overshootPercent,
      undershootPercent,
      settlingTimeMs,
      dampingRatio,
      desired: desiredSlice,
      actual: actualSlice,
    });
  }

  return events;
}
