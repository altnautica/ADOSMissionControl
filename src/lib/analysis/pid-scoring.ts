/**
 * PID analysis scoring and issue detection helpers.
 *
 * Extracted from pid-analysis-worker.ts so the worker stays under 300 lines.
 *
 * @license GPL-3.0-only
 */

import type {
  FFTResult,
  MotorAnalysis,
  StepResponseResult,
  TrackingQualityResult,
  TuneIssue,
  VibrationSummary,
} from "./types";

/**
 * Score FFT noise quality (0-100). Lower peaks = better.
 * Null when no axis has gyro data.
 */
export function scoreFFTQuality(fft: FFTResult): number | null {
  let totalPeakMag = 0;
  let peakCount = 0;
  let measured = false;

  for (const axis of [fft.roll, fft.pitch, fft.yaw] as const) {
    if (axis.noiseFloorDb === null) continue;
    measured = true;
    for (const peak of axis.peaks) {
      totalPeakMag += Math.abs(peak.magnitudeDb - axis.noiseFloorDb);
      peakCount++;
    }
  }

  if (!measured) return null;
  if (peakCount === 0) return 100;

  const avgProminence = totalPeakMag / peakCount;
  return Math.max(0, Math.round(100 - avgProminence * 2.5));
}

/** Score step response quality (0-100). Null when no step events were found. */
export function scoreStepResponse(step: StepResponseResult): number | null {
  const allEvents = [...step.roll, ...step.pitch, ...step.yaw];
  if (allEvents.length === 0) return null;

  let totalScore = 0;
  for (const event of allEvents) {
    let score = 100;

    if (event.riseTimeMs > 50) {
      score -= Math.min((event.riseTimeMs - 50) * 0.5, 30);
    }
    if (event.overshootPercent > 20) {
      score -= Math.min((event.overshootPercent - 20) * 0.5, 30);
    }
    if (event.settlingTimeMs > 200) {
      score -= Math.min((event.settlingTimeMs - 200) * 0.1, 20);
    }
    if (event.dampingRatio < 0.5) {
      score -= (0.5 - event.dampingRatio) * 40;
    } else if (event.dampingRatio > 1.5) {
      score -= (event.dampingRatio - 1.5) * 20;
    }

    totalScore += Math.max(0, score);
  }

  return Math.round(totalScore / allEvents.length);
}

/** Weights of the tune score parts. They are renormalized over the measured parts. */
const TUNE_SCORE_WEIGHTS = {
  tracking: 0.4,
  motors: 0.25,
  fft: 0.2,
  step: 0.15,
} as const;

/**
 * Overall tune score (0-100): the weighted mean of the parts that were
 * measured. A part that is null (its log data is absent) is left out and the
 * remaining weights are renormalized. Null when no part was measured.
 */
export function computeTuneScore(parts: {
  tracking: number | null;
  motors: number | null;
  fft: number | null;
  step: number | null;
}): number | null {
  let weighted = 0;
  let weightSum = 0;
  for (const key of Object.keys(TUNE_SCORE_WEIGHTS) as (keyof typeof TUNE_SCORE_WEIGHTS)[]) {
    const value = parts[key];
    if (value === null) continue;
    weighted += value * TUNE_SCORE_WEIGHTS[key];
    weightSum += TUNE_SCORE_WEIGHTS[key];
  }
  return weightSum > 0 ? Math.round(weighted / weightSum) : null;
}

/** Detect tune issues from analysis results. */
export function detectIssues(
  fft: FFTResult,
  step: StepResponseResult,
  tracking: TrackingQualityResult,
  motorAnalysis: MotorAnalysis,
  vibLevel: VibrationSummary["level"] | null,
  missingMessages: string[] = [],
): TuneIssue[] {
  const issues: TuneIssue[] = [];

  // Absent log data: named, and the metrics that depend on it are not scored
  if (missingMessages.length > 0) {
    issues.push({
      severity: "info",
      title: "Log data missing",
      description: `No ${missingMessages.join(", ")} messages in this log. The metrics that depend on them are not scored; enable them in LOG_BITMASK and log another flight.`,
    });
  }

  // Propwash peaks
  for (const axis of [fft.roll, fft.pitch, fft.yaw] as const) {
    if (axis.noiseFloorDb === null) continue;
    const propwashPeaks = axis.peaks.filter((p) => p.zone === "propwash");
    if (propwashPeaks.length > 0) {
      const strongest = propwashPeaks[0];
      const prominence = strongest.magnitudeDb - axis.noiseFloorDb;
      if (prominence > 10) {
        issues.push({
          severity: prominence > 20 ? "critical" : "warning",
          title: `Propwash oscillation on ${axis.axis}`,
          description: `${strongest.frequency.toFixed(0)} Hz peak at ${strongest.magnitudeDb.toFixed(1)} dB (${prominence.toFixed(1)} dB above noise floor)`,
          affectedAxis: axis.axis,
        });
      }
    }
  }

  // Motor oscillation
  for (const motor of motorAnalysis.motors) {
    if (motor.hasOscillation) {
      issues.push({
        severity: "warning",
        title: `Motor ${motor.motorIndex + 1} oscillation`,
        description: `PWM standard deviation ${motor.oscillationScore.toFixed(1)} (threshold: 50)`,
        affectedMotor: motor.motorIndex,
      });
    }
  }

  // Motor saturation
  for (const motor of motorAnalysis.motors) {
    if (motor.saturationPercent > 5) {
      issues.push({
        severity: motor.saturationPercent > 20 ? "critical" : "warning",
        title: `Motor ${motor.motorIndex + 1} saturation`,
        description: `${motor.saturationPercent.toFixed(1)}% of samples above 1900us`,
        affectedMotor: motor.motorIndex,
      });
    }
  }

  // Motor imbalance
  if (motorAnalysis.imbalanceScore !== null && motorAnalysis.imbalanceScore > 10) {
    issues.push({
      severity: motorAnalysis.imbalanceScore > 20 ? "critical" : "warning",
      title: "Motor imbalance detected",
      description: `Imbalance score ${motorAnalysis.imbalanceScore.toFixed(1)}% — check motor mounting, props, and CG`,
    });
  }

  // Tracking quality
  for (const axis of [tracking.roll, tracking.pitch, tracking.yaw] as const) {
    if (axis.score === null || axis.rmsError === null || axis.phaseLagMs === null) continue;
    if (axis.score < 50) {
      issues.push({
        severity: axis.score < 25 ? "critical" : "warning",
        title: `Poor tracking on ${axis.axis}`,
        description: `RMS error ${axis.rmsError.toFixed(1)} deg/s, score ${axis.score}/100, phase lag ${axis.phaseLagMs.toFixed(1)} ms`,
        affectedAxis: axis.axis,
      });
    }
  }

  // Step response problems
  for (const axis of ["roll", "pitch", "yaw"] as const) {
    const events = step[axis];
    if (events.length === 0) continue;

    const avgOvershoot =
      events.reduce((s, e) => s + e.overshootPercent, 0) / events.length;
    if (avgOvershoot > 30) {
      issues.push({
        severity: avgOvershoot > 50 ? "critical" : "warning",
        title: `High overshoot on ${axis}`,
        description: `Average ${avgOvershoot.toFixed(0)}% overshoot — consider reducing D or P gain`,
        affectedAxis: axis,
      });
    }

    const avgUndershoot =
      events.reduce((s, e) => s + e.undershootPercent, 0) / events.length;
    if (avgUndershoot > 20) {
      issues.push({
        severity: "warning",
        title: `Slow response on ${axis}`,
        description: `Average peak response ${avgUndershoot.toFixed(0)}% short of the requested rate — the axis does not reach its target; consider raising P or FF gain`,
        affectedAxis: axis,
      });
    }
  }

  // Vibration
  if (vibLevel === "bad") {
    issues.push({
      severity: "critical",
      title: "High vibration levels",
      description:
        "Vibration exceeds safe limits — check mounting, props, and frame integrity before PID tuning",
    });
  } else if (vibLevel === "marginal") {
    issues.push({
      severity: "warning",
      title: "Marginal vibration levels",
      description:
        "Vibration is elevated — physical vibration isolation may help before further PID tuning",
    });
  }

  return issues;
}
