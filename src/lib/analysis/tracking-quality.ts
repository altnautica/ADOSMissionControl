/**
 * Tracking quality analysis for PID tuning.
 *
 * Aligns desired and actual rate time series, computes RMS error,
 * estimates phase lag via cross-correlation, and produces a quality score.
 *
 * @license GPL-3.0-only
 */

import type { TimeSample, TrackingAxisResult } from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Align two time series by nearest-neighbor interpolation.
 * Uses the `reference` timestamps and finds the closest `target` value
 * for each reference timestamp.
 */
function alignSeries(
  reference: TimeSample[],
  target: TimeSample[],
): { aligned: TimeSample[]; indices: number[] } {
  const aligned: TimeSample[] = [];
  const indices: number[] = [];
  let tIdx = 0;

  for (const ref of reference) {
    // Advance target index to nearest timestamp
    while (
      tIdx < target.length - 1 &&
      Math.abs(target[tIdx + 1].timeUs - ref.timeUs) <=
        Math.abs(target[tIdx].timeUs - ref.timeUs)
    ) {
      tIdx++;
    }
    aligned.push({ timeUs: ref.timeUs, value: target[tIdx].value });
    indices.push(tIdx);
  }

  return { aligned, indices };
}

/**
 * Compute cross-correlation between two equal-length value arrays
 * at a range of lag offsets (in samples). Returns the lag that maximizes
 * the normalized cross-correlation.
 */
function findPhaseLagSamples(
  desired: number[],
  actual: number[],
  maxLagSamples: number,
): number {
  const n = desired.length;
  if (n === 0) return 0;

  // Compute means
  let meanD = 0;
  let meanA = 0;
  for (let i = 0; i < n; i++) {
    meanD += desired[i];
    meanA += actual[i];
  }
  meanD /= n;
  meanA /= n;

  // Compute denominator (product of std deviations)
  let sumD2 = 0;
  let sumA2 = 0;
  for (let i = 0; i < n; i++) {
    const dd = desired[i] - meanD;
    const da = actual[i] - meanA;
    sumD2 += dd * dd;
    sumA2 += da * da;
  }
  const denom = Math.sqrt(sumD2 * sumA2);
  if (denom < 1e-12) return 0;

  // Sweep lags
  let bestLag = 0;
  let bestCorr = -Infinity;

  for (let lag = -maxLagSamples; lag <= maxLagSamples; lag++) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < n; i++) {
      const j = i + lag;
      if (j >= 0 && j < n) {
        sum += (desired[i] - meanD) * (actual[j] - meanA);
        count++;
      }
    }
    if (count > 0) {
      const corr = sum / denom;
      if (corr > bestCorr) {
        bestCorr = corr;
        bestLag = lag;
      }
    }
  }

  return bestLag;
}

/**
 * Map RMS error to a 0-100 quality score.
 *   <2 deg/s  = 100
 *   >20 deg/s = 0
 *   Linear interpolation between.
 */
function rmsToScore(rms: number): number {
  if (rms <= 2) return 100;
  if (rms >= 20) return 0;
  return Math.round(100 * (1 - (rms - 2) / 18));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze tracking quality between desired and actual rate time series.
 *
 * @param desired  Desired rate time series (e.g., from RATE.RDes)
 * @param actual   Actual rate time series (e.g., from RATE.R)
 * @param axis     Which axis
 * @returns Tracking quality metrics with RMS error, phase lag, and score.
 *   The metrics are null when either series is empty (nothing was measured).
 */
export function analyzeTracking(
  desired: TimeSample[],
  actual: TimeSample[],
  axis: "roll" | "pitch" | "yaw",
): TrackingAxisResult {
  if (desired.length === 0 || actual.length === 0) {
    return {
      axis,
      rmsError: null,
      phaseLagMs: null,
      score: null,
      desired: [],
      actual: [],
      error: [],
    };
  }

  // Align actual to desired timestamps
  const { aligned: alignedActual } = alignSeries(desired, actual);

  // Compute error time series
  const error: TimeSample[] = new Array(desired.length);
  let sumSqError = 0;

  for (let i = 0; i < desired.length; i++) {
    const err = desired[i].value - alignedActual[i].value;
    error[i] = { timeUs: desired[i].timeUs, value: err };
    sumSqError += err * err;
  }

  const rmsError = Math.sqrt(sumSqError / desired.length);

  // Estimate sample rate from desired timestamps
  let dtSum = 0;
  for (let i = 1; i < Math.min(desired.length, 100); i++) {
    dtSum += desired[i].timeUs - desired[i - 1].timeUs;
  }
  const avgDtUs = dtSum / Math.min(desired.length - 1, 99);
  const sampleRateHz = avgDtUs > 0 ? 1e6 / avgDtUs : 400;

  // Phase lag via cross-correlation
  // Search up to 50ms of lag
  const maxLagSamples = Math.ceil(0.05 * sampleRateHz);
  const desiredValues = desired.map((s) => s.value);
  const actualValues = alignedActual.map((s) => s.value);
  const lagSamples = findPhaseLagSamples(desiredValues, actualValues, maxLagSamples);
  const phaseLagMs = (lagSamples / sampleRateHz) * 1000;

  const score = rmsToScore(rmsError);

  return {
    axis,
    rmsError,
    phaseLagMs: Math.abs(phaseLagMs),
    score,
    desired,
    actual: alignedActual,
    error,
  };
}
