/**
 * Motor output analysis for PID tuning.
 *
 * Analyzes PWM time series from RCOU messages to detect saturation,
 * oscillation, imbalance, and compute a health score.
 *
 * @license GPL-3.0-only
 */

import type {
  MotorTimeSeries,
  MotorAnalysis,
  MotorAnalysisResult,
} from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** PWM threshold for motor saturation (microseconds). */
const SATURATION_THRESHOLD = 1900;

/** Std deviation threshold for oscillation detection. */
const OSCILLATION_STDDEV_THRESHOLD = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
  }
  return sum / values.length;
}

function stddev(values: number[], avg: number): number {
  if (values.length < 2) return 0;
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i] - avg;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / (values.length - 1));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze motor PWM outputs for health, saturation, oscillation, and imbalance.
 *
 * @param timeSeries  Motor PWM time series (from RCOU messages)
 * @returns Motor analysis with per-motor stats and overall health score.
 *   With no motor samples at all nothing was measured: the motor list is
 *   empty and the imbalance and health scores are null.
 */
export function analyzeMotors(timeSeries: MotorTimeSeries): MotorAnalysis {
  const hasSamples = timeSeries.motors.some((m) => m && m.length > 0);
  if (!hasSamples) {
    return { motors: [], imbalanceScore: null, healthScore: null, timeSeries };
  }

  const motorResults: MotorAnalysisResult[] = [];
  const averages: number[] = [];

  for (let m = 0; m < timeSeries.motorCount; m++) {
    const samples = timeSeries.motors[m];
    if (!samples || samples.length === 0) {
      motorResults.push({
        motorIndex: m,
        averagePwm: 0,
        saturationPercent: 0,
        oscillationScore: 0,
        hasOscillation: false,
      });
      averages.push(0);
      continue;
    }

    const values = samples.map((s) => s.value);
    const avg = mean(values);
    averages.push(avg);

    // Saturation: percentage of samples above threshold
    let saturatedCount = 0;
    for (const v of values) {
      if (v > SATURATION_THRESHOLD) saturatedCount++;
    }
    const saturationPercent = (saturatedCount / values.length) * 100;

    // Oscillation: standard deviation of PWM output
    const sd = stddev(values, avg);
    const hasOscillation = sd > OSCILLATION_STDDEV_THRESHOLD;

    motorResults.push({
      motorIndex: m,
      averagePwm: Math.round(avg),
      saturationPercent: Math.round(saturationPercent * 10) / 10,
      oscillationScore: Math.round(sd * 10) / 10,
      hasOscillation,
    });
  }

  // Imbalance: max difference between motor averages / mean average * 100
  const activeAverages = averages.filter((a) => a > 0);
  let imbalanceScore = 0;

  if (activeAverages.length >= 2) {
    const overallMean = mean(activeAverages);
    if (overallMean > 0) {
      const maxDiff = Math.max(...activeAverages) - Math.min(...activeAverages);
      imbalanceScore = Math.round((maxDiff / overallMean) * 100 * 10) / 10;
    }
  }

  // Health score: 100 - penalties
  // Saturation penalty: average saturation across motors (max 40 points)
  const avgSaturation = mean(motorResults.map((m) => m.saturationPercent));
  const saturationPenalty = Math.min(avgSaturation * 0.8, 40);

  // Oscillation penalty: count of oscillating motors (max 30 points)
  const oscillatingCount = motorResults.filter((m) => m.hasOscillation).length;
  const oscillationPenalty = Math.min(oscillatingCount * 10, 30);

  // Imbalance penalty: imbalance score scaled (max 30 points)
  const imbalancePenalty = Math.min(imbalanceScore * 1.5, 30);

  const healthScore = Math.max(
    0,
    Math.round(100 - saturationPenalty - oscillationPenalty - imbalancePenalty),
  );

  return {
    motors: motorResults,
    imbalanceScore,
    healthScore,
    timeSeries,
  };
}
