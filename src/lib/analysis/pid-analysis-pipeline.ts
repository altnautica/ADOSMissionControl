/**
 * PID analysis pipeline over a parsed DataFlash log:
 *   extract data → FFT → step response → tracking → motors → score
 *
 * Kept free of worker globals so it runs in the analysis worker and in tests.
 * Imports are relative because the worker bundle cannot resolve @/ aliases.
 *
 * @license GPL-3.0-only
 */

import type { DataFlashLog } from "../dataflash-parser";
import { extractLogData } from "./log-extractor";
import { computeFFT } from "./fft";
import { extractStepResponses } from "./step-response";
import { analyzeTracking } from "./tracking-quality";
import { analyzeMotors } from "./motor-analysis";
import {
  scoreFFTQuality,
  scoreStepResponse,
  computeTuneScore,
  detectIssues,
} from "./pid-scoring";
import type {
  PidAnalysisResult,
  FFTResult,
  StepResponseResult,
  TrackingQualityResult,
  AxisTimeSeries,
} from "./types";

const AXES = ["roll", "pitch", "yaw"] as const;

function isEmpty(series: AxisTimeSeries): boolean {
  return AXES.every((axis) => series[axis].length === 0);
}

/** Mean of the measured values, rounded; null when none was measured. */
function meanOfMeasured(values: (number | null)[]): number | null {
  const measured = values.filter((v): v is number => v !== null);
  if (measured.length === 0) return null;
  return Math.round(measured.reduce((s, v) => s + v, 0) / measured.length);
}

/** Run the full analysis. `onProgress` receives stage labels and percentages. */
export function analyzePidLog(
  log: DataFlashLog,
  fileSizeBytes: number,
  onProgress: (stage: string, percent: number) => void = () => {},
): PidAnalysisResult {
  onProgress("Extracting data...", 20);
  const data = extractLogData(log, fileSizeBytes);

  onProgress("Computing FFT...", 40);
  const gyroRate = data.sampleRates.gyro || 400;
  const fft: FFTResult = {
    roll: computeFFT(data.gyro.roll, gyroRate, "roll"),
    pitch: computeFFT(data.gyro.pitch, gyroRate, "pitch"),
    yaw: computeFFT(data.gyro.yaw, gyroRate, "yaw"),
  };

  onProgress("Analyzing step response...", 55);
  const stepResponse: StepResponseResult = {
    roll: extractStepResponses(data.desiredRate.roll, data.actualRate.roll, "roll"),
    pitch: extractStepResponses(data.desiredRate.pitch, data.actualRate.pitch, "pitch"),
    yaw: extractStepResponses(data.desiredRate.yaw, data.actualRate.yaw, "yaw"),
  };

  onProgress("Evaluating tracking...", 70);
  const roll = analyzeTracking(data.desiredRate.roll, data.actualRate.roll, "roll");
  const pitch = analyzeTracking(data.desiredRate.pitch, data.actualRate.pitch, "pitch");
  const yaw = analyzeTracking(data.desiredRate.yaw, data.actualRate.yaw, "yaw");
  const tracking: TrackingQualityResult = {
    roll,
    pitch,
    yaw,
    overallScore: meanOfMeasured([roll.score, pitch.score, yaw.score]),
  };

  onProgress("Analyzing motors...", 85);
  const motors = analyzeMotors(data.motors);

  onProgress("Scoring...", 95);
  const vibration = data.vibration;

  const missingMessages: string[] = [];
  if (isEmpty(data.desiredRate) && isEmpty(data.actualRate)) missingMessages.push("RATE");
  if (isEmpty(data.gyro)) missingMessages.push("IMU");
  if (motors.healthScore === null) missingMessages.push("RCOU");
  if (vibration === null) missingMessages.push("VIBE");

  const tuneScore = computeTuneScore({
    tracking: tracking.overallScore,
    motors: motors.healthScore,
    fft: scoreFFTQuality(fft),
    step: scoreStepResponse(stepResponse),
  });

  const issues = detectIssues(
    fft,
    stepResponse,
    tracking,
    motors,
    vibration?.level ?? null,
    missingMessages,
  );

  return {
    metadata: data.metadata,
    fft,
    stepResponse,
    tracking,
    motors,
    vibration,
    tuneScore,
    issues,
  };
}
