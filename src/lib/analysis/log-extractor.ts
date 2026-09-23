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
  type DataFlashMessage,
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
  log: DataFlashLog,
  type: string,
  instanceField: string,
): DataFlashMessage[] {
  const msgs = getMessages(log, type);
  let primary = Infinity;
  for (const msg of msgs) {
    const inst = msg.fields[instanceField];
    if (typeof inst === "number" && inst < primary) primary = inst;
  }
  if (primary === Infinity) return msgs;
  return msgs.filter((msg) => msg.fields[instanceField] === primary);
}

/** Time series of one numeric field over a set of rows. */
function seriesOf(rows: DataFlashMessage[], field: string): TimeSample[] {
  const series: TimeSample[] = [];
  for (const msg of rows) {
    if (msg.timestamp == null) continue;
    const value = msg.fields[field];
    if (typeof value !== "number") continue;
    series.push({ timeUs: msg.timestamp, value });
  }
  return series;
}

/** Gyro series of the primary IMU instance. */
function extractGyro(log: DataFlashLog): AxisTimeSeries {
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
function extractMotors(log: DataFlashLog): MotorTimeSeries {
  const functionByOutput = new Map<number, number>();
  for (const msg of getMessages(log, "PARM")) {
    const name = msg.fields["Name"];
    const value = msg.fields["Value"];
    if (typeof name !== "string" || typeof value !== "number") continue;
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
    .map((o) => getTimeSeries(log, o <= 14 ? "RCOU" : "RCO2", `C${o}`))
    .filter((s) => s.length > 0);
  return { motors, motorCount: motors.length };
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
 * Total clip count: the last value of every clip counter, summed. Current
 * logs carry one cumulative `Clip` per IMU instance (instance field `IMU`);
 * older logs carry `Clip0`..`Clip2` on a single row. Null when the log has
 * no clip counter at all, which is not the same as zero clipping.
 */
function extractClipCount(log: DataFlashLog): number | null {
  const last = new Map<string, number>();
  for (const msg of getMessages(log, "VIBE")) {
    const inst = msg.fields["IMU"];
    for (const key of ["Clip", "Clip0", "Clip1", "Clip2"]) {
      const value = msg.fields[key];
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
export function extractVibration(log: DataFlashLog): VibrationSummary | null {
  const rows = primaryInstanceRows(log, "VIBE", "IMU");
  const xVals = seriesOf(rows, "VibeX").map((s) => s.value);
  const yVals = seriesOf(rows, "VibeY").map((s) => s.value);
  const zVals = seriesOf(rows, "VibeZ").map((s) => s.value);
  if (xVals.length === 0 && yVals.length === 0 && zVals.length === 0) return null;

  const avgX = mean(xVals);
  const avgY = mean(yVals);
  const avgZ = mean(zVals);

  const maxX = xVals.length > 0 ? Math.max(...xVals) : 0;
  const maxY = yVals.length > 0 ? Math.max(...yVals) : 0;
  const maxZ = zVals.length > 0 ? Math.max(...zVals) : 0;

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
  const gyroX = extractGyro(log).roll;
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
