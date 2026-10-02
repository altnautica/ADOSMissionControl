/**
 * DataFlash log data extraction for PID analysis.
 *
 * Extracts rate, gyro, motor, vibration, and parameter data from a parsed
 * DataFlash log into typed time series suitable for the analysis modules.
 *
 * @license GPL-3.0-only
 */

import type { DataflashLog, DataflashRecord } from "../dataflash/parser";
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
  /** Vibration summary (from VIBE messages); null when the log has none. */
  vibration: VibrationSummary | null;
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

/**
 * Messages PID analysis reads. Parse with this as the `only` filter so the
 * rest of the log is stepped over instead of decoded and held; parameters
 * come from `log.params`, which every parse fills.
 */
export const PID_LOG_MESSAGES: ReadonlySet<string> = new Set(["RATE", "IMU", "RCOU", "RCO2", "VIBE"]);

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

/**
 * Rows of the lowest sensor instance present for a message type.
 *
 * Current ArduPilot logs write one IMU/VIBE row per sensor instance per tick,
 * all sharing the same TimeUS and tagged by an instance field. Mixing them
 * would interleave several sensors into one series. Older logs carry no
 * instance field and hold a single instance, so every row is kept.
 */
function primaryInstanceRows(
  log: DataflashLog,
  type: string,
  instanceField: string,
): DataflashRecord[] {
  const rows = log.messages.get(type) ?? [];
  let primary = Infinity;
  for (const row of rows) {
    const inst = row[instanceField];
    if (typeof inst === "number" && inst < primary) primary = inst;
  }
  if (primary === Infinity) return rows;
  return rows.filter((row) => row[instanceField] === primary);
}

/** Time series of one numeric field over a set of rows; rows without a TimeUS are skipped. */
function seriesOf(rows: readonly DataflashRecord[], field: string): TimeSample[] {
  const series: TimeSample[] = [];
  for (const row of rows) {
    const timeUs = row.TimeUS;
    const value = row[field];
    if (typeof timeUs !== "number" || typeof value !== "number") continue;
    series.push({ timeUs, value });
  }
  return series;
}

/** Time series of one field of one message type. */
function timeSeries(log: DataflashLog, type: string, field: string): TimeSample[] {
  return seriesOf(log.messages.get(type) ?? [], field);
}

/** Gyro series of the primary IMU instance. */
function extractGyro(log: DataflashLog): AxisTimeSeries {
  const rows = primaryInstanceRows(log, "IMU", "I");
  return {
    roll: seriesOf(rows, "GyrX"),
    pitch: seriesOf(rows, "GyrY"),
    yaw: seriesOf(rows, "GyrZ"),
  };
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
  log: DataflashLog,
  fileSizeBytes = 0,
): ExtractedLogData {
  // --- Rate data (RATE messages) ---
  const rollDes = timeSeries(log, "RATE", "RDes");
  const rollAct = timeSeries(log, "RATE", "R");
  const pitchDes = timeSeries(log, "RATE", "PDes");
  const pitchAct = timeSeries(log, "RATE", "P");
  const yawDes = timeSeries(log, "RATE", "YDes");
  const yawAct = timeSeries(log, "RATE", "Y");

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

  // --- Gyro data (IMU messages, primary instance) ---
  const gyro = extractGyro(log);

  // --- Motor outputs (RCOU messages) ---
  const motors = extractMotors(log);

  // --- Vibration ---
  const vibration = extractVibration(log);

  // --- Parameters ---
  const params = extractParams(log);

  // --- Sample rates ---
  const gyroRate = estimateSampleRate(gyro.roll);
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
 * Motor number for an ArduPilot SERVOn_FUNCTION value (SRV_Channel k_motor1..
 * k_motor32), or null when the output drives something else.
 */
function motorNumberOf(fn: number): number | null {
  if (fn >= 33 && fn <= 40) return fn - 32;
  if (fn >= 82 && fn <= 85) return fn - 73;
  if (fn >= 160 && fn <= 179) return fn - 147;
  return null;
}

/** RCOU carries outputs C1..C14, RCO2 carries C15..C18. */
const LOGGED_OUTPUTS = 18;

/**
 * Extract motor PWM time series, in motor order. The outputs are the ones the
 * log's SERVOn_FUNCTION parameters assign to motors, so gimbal, camera and
 * servo channels are never analysed as motors. A log without those
 * parameters falls back to C1..C8. Outputs with no logged samples are left
 * out rather than padded in as empty motors.
 */
function extractMotors(log: DataflashLog): MotorTimeSeries {
  const functionByOutput = new Map<number, number>();
  for (const [name, value] of log.params) {
    const match = /^SERVO(\d+)_FUNCTION$/.exec(name);
    if (match) functionByOutput.set(Number(match[1]), value);
  }

  let outputs: number[];
  if (functionByOutput.size > 0) {
    outputs = [...functionByOutput.entries()]
      .flatMap(([output, fn]) => {
        const motor = motorNumberOf(fn);
        return motor !== null && output <= LOGGED_OUTPUTS ? [{ output, motor }] : [];
      })
      .sort((a, b) => a.motor - b.motor)
      .map((m) => m.output);
  } else {
    outputs = [1, 2, 3, 4, 5, 6, 7, 8];
  }

  const motors = outputs
    .map((o) => timeSeries(log, o <= 14 ? "RCOU" : "RCO2", `C${o}`))
    .filter((s) => s.length > 0);
  return { motors, motorCount: motors.length };
}

/**
 * Extract PID-related parameters from the log's parameters.
 */
function extractParams(log: DataflashLog): Record<string, number> {
  const params: Record<string, number> = {};
  for (const [name, value] of log.params) {
    if (PID_PARAM_PREFIXES.some((prefix) => name.startsWith(prefix))) params[name] = value;
  }
  return params;
}

/**
 * Total clip count: the last value of every clip counter, summed. Current
 * logs carry one cumulative `Clip` per IMU instance (instance field `IMU`);
 * older logs carry `Clip0`..`Clip2` on a single row. Null when the log has
 * no clip counter at all, which is not the same as zero clipping.
 */
function extractClipCount(log: DataflashLog): number | null {
  const last = new Map<string, number>();
  for (const row of log.messages.get("VIBE") ?? []) {
    const inst = row["IMU"];
    for (const key of ["Clip", "Clip0", "Clip1", "Clip2"]) {
      const value = row[key];
      if (typeof value === "number") last.set(`${key}:${inst ?? 0}`, value);
    }
  }
  if (last.size === 0) return null;
  let total = 0;
  for (const value of last.values()) total += value;
  return total;
}

/**
 * Extract vibration summary from VIBE messages of the primary IMU instance.
 * Returns null when the log holds no VIBE data.
 */
export function extractVibration(log: DataflashLog): VibrationSummary | null {
  const rows = primaryInstanceRows(log, "VIBE", "IMU");
  const xVals = seriesOf(rows, "VibeX").map((s) => s.value);
  const yVals = seriesOf(rows, "VibeY").map((s) => s.value);
  const zVals = seriesOf(rows, "VibeZ").map((s) => s.value);
  if (xVals.length === 0 && yVals.length === 0 && zVals.length === 0) return null;

  const avgX = mean(xVals);
  const avgY = mean(yVals);
  const avgZ = mean(zVals);

  let maxX = 0;
  let maxY = 0;
  let maxZ = 0;
  for (const v of xVals) if (v > maxX) maxX = v;
  for (const v of yVals) if (v > maxY) maxY = v;
  for (const v of zVals) if (v > maxZ) maxZ = v;

  const clipCount = extractClipCount(log);

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
  log: DataflashLog,
  fileSizeBytes: number,
): LogMetadata {
  // Duration: from earliest to latest timestamp across the decoded messages
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const [, rows] of log.messages) {
    for (const row of rows) {
      const t = row.TimeUS;
      if (typeof t !== "number") continue;
      if (t < minTime) minTime = t;
      if (t > maxTime) maxTime = t;
    }
  }

  const durationSec =
    minTime < Infinity ? (maxTime - minTime) / 1e6 : 0;

  // Sample rates
  const gyroX = extractGyro(log).roll;
  const rateDes = timeSeries(log, "RATE", "RDes");
  const rcouCount = log.messages.get("RCOU")?.length ?? 0;

  const gyroSampleRate = Math.round(estimateSampleRate(gyroX));
  const rateSampleRate = Math.round(estimateSampleRate(rateDes));

  // Params
  const logParams = extractParams(log);

  return {
    durationSec: Math.round(durationSec * 10) / 10,
    gyroSampleRate,
    rateSampleRate,
    motorSampleCount: rcouCount,
    fileSizeBytes,
    logParams,
  };
}
