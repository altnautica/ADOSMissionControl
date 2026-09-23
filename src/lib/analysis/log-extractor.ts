/**
 * DataFlash log data extraction for PID analysis.
 *
 * Extracts rate, gyro, motor, vibration, and parameter data from a parsed
 * DataFlash log into typed time series suitable for the analysis modules.
 *
 * @license GPL-3.0-only
 */

import {
  type DataFlashLog,
  getTimeSeries,
  getMessages,
} from "@/lib/dataflash-parser";
import type {
  AxisTimeSeries,
  MotorTimeSeries,
  TimeSample,
  VibrationSummary,
  LogMetadata,
} from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Extracted data interface
// ---------------------------------------------------------------------------

/** All data extracted from a log file for PID analysis. */
export interface ExtractedLogData {
  /** Desired rate time series (from RATE messages). */
  desiredRate: AxisTimeSeries;
  /** Actual rate time series (from RATE messages). */
  actualRate: AxisTimeSeries;
  /** Raw gyro data (from IMU messages, for FFT). */
  gyro: AxisTimeSeries;
  /** Motor PWM outputs (from RCOU messages). */
  motors: MotorTimeSeries;
  /** Vibration summary (from VIBE messages). */
  vibration: VibrationSummary;
  /** Log metadata. */
  metadata: LogMetadata;
  /** PID-related parameters from PARM messages. */
  params: Record<string, number>;
  /** Sample rates in Hz. */
  sampleRates: {
    gyro: number;
    rate: number;
    motor: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PID-related parameter prefixes to extract from PARM messages. */
const PID_PARAM_PREFIXES = [
  "ATC_RAT_RLL_",
  "ATC_RAT_PIT_",
  "ATC_RAT_YAW_",
  "ATC_ANG_RLL_",
  "ATC_ANG_PIT_",
  "ATC_ANG_YAW_",
  "RLL_RATE_",
  "PTCH_RATE_",
  "RLL2SRV_",
  "PTCH2SRV_",
  "YAW2SRV_",
  "INS_GYRO_FILTER",
  "INS_ACCEL_FILTER",
  "INS_HNTCH_",
  "INS_HNTC2_",
  "ATC_INPUT_TC",
  "ATC_RATE_FF_ENAB",
  "MOT_THST_EXPO",
  "MOT_SPIN_MIN",
  "MOT_SPIN_ARM",
  "MOT_BAT_VOLT_MAX",
  "MOT_BAT_VOLT_MIN",
];

/** Estimate sample rate from a time series (using first N samples). */
function estimateSampleRate(samples: TimeSample[], maxSamples = 200): number {
  if (samples.length < 2) return 0;
  const n = Math.min(samples.length, maxSamples);
  let dtSum = 0;
  let dtCount = 0;
  for (let i = 1; i < n; i++) {
    const dt = samples[i].timeUs - samples[i - 1].timeUs;
    if (dt > 0 && dt < 1e6) {
      // Ignore gaps > 1 second
      dtSum += dt;
      dtCount++;
    }
  }
  if (dtCount === 0) return 0;
  const avgDtUs = dtSum / dtCount;
  return avgDtUs > 0 ? 1e6 / avgDtUs : 0;
}

/** Compute mean of an array of numbers. */
function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return sum / arr.length;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract all relevant data from a parsed DataFlash log for PID analysis.
 *
 * Extracts:
 *   - RATE messages → desired and actual rate per axis
 *   - IMU messages → raw gyro data per axis (for FFT)
 *   - RCOU messages → motor PWM outputs
 *   - VIBE messages → vibration summary
 *   - PARM messages → PID-related parameters
 */
export function extractLogData(
  log: DataFlashLog,
  fileSizeBytes = 0,
): ExtractedLogData {
  // --- Rate data (RATE messages) ---
  const rollDes = getTimeSeries(log, "RATE", "RDes");
  const rollAct = getTimeSeries(log, "RATE", "R");
  const pitchDes = getTimeSeries(log, "RATE", "PDes");
  const pitchAct = getTimeSeries(log, "RATE", "P");
  const yawDes = getTimeSeries(log, "RATE", "YDes");
  const yawAct = getTimeSeries(log, "RATE", "Y");

  const desiredRate: AxisTimeSeries = {
    roll: rollDes,
    pitch: pitchDes,
    yaw: yawDes,
  };

  const actualRate: AxisTimeSeries = {
    roll: rollAct,
    pitch: pitchAct,
    yaw: yawAct,
  };

  // --- Gyro data (IMU messages) ---
  const gyroX = getTimeSeries(log, "IMU", "GyrX");
  const gyroY = getTimeSeries(log, "IMU", "GyrY");
  const gyroZ = getTimeSeries(log, "IMU", "GyrZ");

  const gyro: AxisTimeSeries = {
    roll: gyroX,
    pitch: gyroY,
    yaw: gyroZ,
  };

  // --- Motor outputs (RCOU messages) ---
  const motors = extractMotors(log);

  // --- Vibration ---
  const vibration = extractVibration(log);

  // --- Parameters ---
  const params = extractParams(log);

  // --- Sample rates ---
  const gyroRate = estimateSampleRate(gyroX);
  const rateRate = estimateSampleRate(rollDes);
  const motorRate = estimateSampleRate(motors.motors[0] ?? []);

  // --- Metadata ---
  const metadata = extractLogMetadata(log, fileSizeBytes);
  metadata.gyroSampleRate = Math.round(gyroRate);
  metadata.rateSampleRate = Math.round(rateRate);

  return {
    desiredRate,
    actualRate,
    gyro,
    motors,
    vibration,
    metadata,
    params,
    sampleRates: {
      gyro: gyroRate,
      rate: rateRate,
      motor: motorRate,
    },
  };
}

/**
 * Extract motor PWM time series from RCOU messages.
 * Detects motor count by checking which C1-C8 channels have data.
 */
function extractMotors(log: DataFlashLog): MotorTimeSeries {
  const channels: TimeSample[][] = [];
  let motorCount = 0;

  for (let i = 1; i <= 8; i++) {
    const ch = getTimeSeries(log, "RCOU", `C${i}`);
    channels.push(ch);
    if (ch.length > 0) motorCount = i;
  }

  return {
    motors: channels.slice(0, Math.max(motorCount, 4)),
    motorCount: Math.max(motorCount, 4),
  };
}

/**
 * Extract PID-related parameters from PARM messages.
 */
function extractParams(log: DataFlashLog): Record<string, number> {
  const params: Record<string, number> = {};
  const parmMsgs = getMessages(log, "PARM");

  for (const msg of parmMsgs) {
    const name = msg.fields["Name"];
    const value = msg.fields["Value"];
    if (typeof name !== "string" || typeof value !== "number") continue;

    // Check if this is a PID-related parameter
    const isPidParam = PID_PARAM_PREFIXES.some((prefix) =>
      name.startsWith(prefix),
    );
    if (isPidParam) {
      params[name] = value;
    }
  }

  return params;
}

/**
 * Extract vibration summary from VIBE messages.
 */
export function extractVibration(log: DataFlashLog): VibrationSummary {
  const vibeX = getTimeSeries(log, "VIBE", "VibeX");
  const vibeY = getTimeSeries(log, "VIBE", "VibeY");
  const vibeZ = getTimeSeries(log, "VIBE", "VibeZ");

  const clip0 = getTimeSeries(log, "VIBE", "Clip0");
  const clip1 = getTimeSeries(log, "VIBE", "Clip1");
  const clip2 = getTimeSeries(log, "VIBE", "Clip2");

  const xVals = vibeX.map((s) => s.value);
  const yVals = vibeY.map((s) => s.value);
  const zVals = vibeZ.map((s) => s.value);

  const avgX = mean(xVals);
  const avgY = mean(yVals);
  const avgZ = mean(zVals);

  const maxX = xVals.length > 0 ? Math.max(...xVals) : 0;
  const maxY = yVals.length > 0 ? Math.max(...yVals) : 0;
  const maxZ = zVals.length > 0 ? Math.max(...zVals) : 0;

  // Total clip count is the max of the last clip counter values
  const lastClip0 = clip0.length > 0 ? clip0[clip0.length - 1].value : 0;
  const lastClip1 = clip1.length > 0 ? clip1[clip1.length - 1].value : 0;
  const lastClip2 = clip2.length > 0 ? clip2[clip2.length - 1].value : 0;
  const clipCount = lastClip0 + lastClip1 + lastClip2;

  // Level classification based on max vibration across axes
  const maxVibe = Math.max(avgX, avgY, avgZ);
  let level: VibrationSummary["level"] = "good";
  if (maxVibe > 30) level = "bad";
  else if (maxVibe > 15) level = "marginal";

  return {
    avgX: Math.round(avgX * 100) / 100,
    avgY: Math.round(avgY * 100) / 100,
    avgZ: Math.round(avgZ * 100) / 100,
    maxX: Math.round(maxX * 100) / 100,
    maxY: Math.round(maxY * 100) / 100,
    maxZ: Math.round(maxZ * 100) / 100,
    clipCount,
    level,
  };
}

/**
 * Extract log metadata: duration, sample rates, file size, and PID params.
 */
export function extractLogMetadata(
  log: DataFlashLog,
  fileSizeBytes: number,
): LogMetadata {
  // Duration: from earliest to latest timestamp across all message types
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const [, msgs] of log.messages) {
    for (const msg of msgs) {
      if (msg.timestamp != null) {
        if (msg.timestamp < minTime) minTime = msg.timestamp;
        if (msg.timestamp > maxTime) maxTime = msg.timestamp;
      }
    }
  }

  const durationSec =
    minTime < Infinity ? (maxTime - minTime) / 1e6 : 0;

  // Sample rates
  const gyroX = getTimeSeries(log, "IMU", "GyrX");
  const rateDes = getTimeSeries(log, "RATE", "RDes");
  const rcouMsgs = getMessages(log, "RCOU");

  const gyroSampleRate = Math.round(estimateSampleRate(gyroX));
  const rateSampleRate = Math.round(estimateSampleRate(rateDes));

  // Params
  const logParams = extractParams(log);

  return {
    durationSec: Math.round(durationSec * 10) / 10,
    gyroSampleRate,
    rateSampleRate,
    motorSampleCount: rcouMsgs.length,
    fileSizeBytes,
    logParams,
  };
}
