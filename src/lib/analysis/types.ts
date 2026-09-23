/**
 * Types for PID analysis engine.
 *
 * Used by the analysis worker, chart components, AI recommendation system,
 * and pid-analysis store.
 *
 * @license GPL-3.0-only
 */

import type { VehicleType } from "@/components/fc/pid/pid-constants";

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

/** A single time-value sample extracted from a DataFlash log. */
export interface TimeSample {
  /** Time in microseconds (from DataFlash TimeUS field). */
  timeUs: number;
  value: number;
}

/** Multi-axis time series for gyro, rate, or motor data. */
export interface AxisTimeSeries {
  roll: TimeSample[];
  pitch: TimeSample[];
  yaw: TimeSample[];
}

/** Motor PWM time series (up to 8 outputs). */
export interface MotorTimeSeries {
  /** Array of per-motor time series. Index 0 = motor 1, etc. */
  motors: TimeSample[][];
  motorCount: number;
}

// ---------------------------------------------------------------------------
// FFT analysis
// ---------------------------------------------------------------------------

/** Single FFT bin: frequency and magnitude. */
export interface FFTBin {
  frequency: number;
  magnitude: number;
}

/** FFT result for a single axis. */
export interface FFTAxisResult {
  axis: "roll" | "pitch" | "yaw";
  /** Averaged power spectrum bins (bounded by the segment length). */
  spectrum: FFTBin[];
  /** Sample rate in Hz (derived from log timestamps). */
  sampleRate: number;
  /** Strongest distinct peaks sorted by magnitude (descending), capped. */
  peaks: FFTPeak[];
  /** Median spectrum level in dB; null when the log holds no gyro samples. */
  noiseFloorDb: number | null;
}

/** A peak detected in the FFT spectrum. */
export interface FFTPeak {
  frequency: number;
  magnitudeDb: number;
  /** Classification hint. */
  zone: "propwash" | "motor" | "structural" | "unknown";
}

/** Combined FFT results for all axes. */
export interface FFTResult {
  roll: FFTAxisResult;
  pitch: FFTAxisResult;
  yaw: FFTAxisResult;
}

// ---------------------------------------------------------------------------
// Step response
// ---------------------------------------------------------------------------

/** Metrics for a single step response event. */
export interface StepResponseEvent {
  /** Start time in microseconds. */
  startTimeUs: number;
  /** Duration of the step event in milliseconds. */
  durationMs: number;
  axis: "roll" | "pitch" | "yaw";
  /** Time from 10% to 90% of target in ms. */
  riseTimeMs: number;
  /** Peak travel beyond the step target as a percentage of step size (0 when the target is never passed). */
  overshootPercent: number;
  /** Shortfall of the peak response below the step target as a percentage of step size (0 when the target is reached). */
  undershootPercent: number;
  /** Time to settle within 5% of target in ms. */
  settlingTimeMs: number;
  /** Damping ratio estimate (0 = undamped, 1 = critically damped). */
  dampingRatio: number;
  /** Desired rate samples during this event. */
  desired: TimeSample[];
  /** Actual rate samples during this event. */
  actual: TimeSample[];
}

/** Step response results for all axes. */
export interface StepResponseResult {
  roll: StepResponseEvent[];
  pitch: StepResponseEvent[];
  yaw: StepResponseEvent[];
}

// ---------------------------------------------------------------------------
// Tracking quality
// ---------------------------------------------------------------------------

/** Tracking quality for a single axis. */
export interface TrackingAxisResult {
  axis: "roll" | "pitch" | "yaw";
  /** RMS tracking error in deg/s; null when the log holds no rate data for this axis. */
  rmsError: number | null;
  /** Estimated phase lag in ms; null when not measured. */
  phaseLagMs: number | null;
  /** Quality score 0-100 (higher = better tracking); null when not measured. */
  score: number | null;
  /** Desired rate time series. */
  desired: TimeSample[];
  /** Actual rate time series. */
  actual: TimeSample[];
  /** Error time series (desired - actual). */
  error: TimeSample[];
}

/** Combined tracking quality results. */
export interface TrackingQualityResult {
  roll: TrackingAxisResult;
  pitch: TrackingAxisResult;
  yaw: TrackingAxisResult;
  /** Overall tracking score (average of the measured axes); null when no axis was measured. */
  overallScore: number | null;
}

// ---------------------------------------------------------------------------
// Motor analysis
// ---------------------------------------------------------------------------

/** Analysis results for a single motor. */
export interface MotorAnalysisResult {
  motorIndex: number;
  /** Average PWM output. */
  averagePwm: number;
  /** Percentage of time motor was saturated (>1900us). */
  saturationPercent: number;
  /** Oscillation detection: standard deviation of PWM output. */
  oscillationScore: number;
  /** Whether this motor shows concerning oscillation. */
  hasOscillation: boolean;
}

/** Combined motor analysis. */
export interface MotorAnalysis {
  motors: MotorAnalysisResult[];
  /** Imbalance score: how uneven the motors are (0 = perfect, 100 = severe); null without motor output data. */
  imbalanceScore: number | null;
  /** Overall motor health score 0-100; null without motor output data. */
  healthScore: number | null;
  /** Raw motor time series for charting. */
  timeSeries: MotorTimeSeries;
}

// ---------------------------------------------------------------------------
// Vibration
// ---------------------------------------------------------------------------

/** Vibration summary from VIBE messages. */
export interface VibrationSummary {
  avgX: number;
  avgY: number;
  avgZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  clipCount: number;
  /** Overall vibe level: "good" (<15), "marginal" (15-30), "bad" (>30). */
  level: "good" | "marginal" | "bad";
}

// ---------------------------------------------------------------------------
// Full analysis result
// ---------------------------------------------------------------------------

/** Log metadata extracted during parsing. */
export interface LogMetadata {
  /** Total duration of the log in seconds. */
  durationSec: number;
  /** Gyro sample rate in Hz. */
  gyroSampleRate: number;
  /** Rate controller sample rate in Hz. */
  rateSampleRate: number;
  /** Number of RCOU messages (motor output rate indicator). */
  motorSampleCount: number;
  /** File size in bytes. */
  fileSizeBytes: number;
  /** PID parameters found in the log (from PARM messages). */
  logParams: Record<string, number>;
}

/** Complete PID analysis result from the worker. */
export interface PidAnalysisResult {
  metadata: LogMetadata;
  fft: FFTResult;
  stepResponse: StepResponseResult;
  tracking: TrackingQualityResult;
  motors: MotorAnalysis;
  /** Vibration summary; null when the log holds no VIBE messages. */
  vibration: VibrationSummary | null;
  /** Overall tune quality score 0-100 over the measured parts; null when nothing was measured. */
  tuneScore: number | null;
  /** List of identified issues. */
  issues: TuneIssue[];
}

/** An issue identified during analysis. */
export interface TuneIssue {
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  /** Affected axis/motor, if applicable. */
  affectedAxis?: "roll" | "pitch" | "yaw";
  affectedMotor?: number;
}

// ---------------------------------------------------------------------------
// AI recommendations
// ---------------------------------------------------------------------------

/** A single parameter change suggestion. */
export interface ParameterSuggestion {
  param: string;
  currentValue: number;
  suggestedValue: number;
  delta: number;
}

/** An AI-generated tuning recommendation. */
export interface AiRecommendation {
  id: string;
  title: string;
  explanation: string;
  priority: "critical" | "important" | "optional";
  confidence: number; // 0-100
  parameters: ParameterSuggestion[];
}

/** Request payload sent to the AI analysis endpoint. */
export interface AiAnalysisRequest {
  vehicleType: VehicleType;
  currentParams: Record<string, number>;
  analysisMetrics: {
    tuneScore: number | null;
    fftPeaks: { axis: string; frequency: number; magnitudeDb: number; zone: string }[];
    stepResponse: {
      axis: string;
      avgOvershoot: number;
      avgUndershoot: number;
      avgRiseTime: number;
      avgSettlingTime: number;
      avgDamping: number;
    }[];
    tracking: { axis: string; rmsError: number; score: number }[];
    motorImbalance: number | null;
    vibrationLevel: string | null;
    issues: { severity: string; title: string; description: string }[];
  };
}

/** Response from the AI analysis endpoint. */
export interface AiAnalysisResponse {
  recommendations: AiRecommendation[];
  summary: string;
  error?: string;
  remaining?: number;
  weeklyLimit?: number;
}

// ---------------------------------------------------------------------------
// Safety constraints
// ---------------------------------------------------------------------------

/** Safety range for a PID parameter. */
export interface ParamSafetyRange {
  min: number;
  max: number;
  /** Maximum allowed change per suggestion. */
  maxDelta: number;
}

// ---------------------------------------------------------------------------
// Worker messages
// ---------------------------------------------------------------------------

/** Message sent TO the analysis worker. */
export type WorkerInMessage =
  | { type: "analyze"; buffer: ArrayBuffer }
  | { type: "cancel" };

/** Message sent FROM the analysis worker. */
export type WorkerOutMessage =
  | { type: "progress"; stage: string; percent: number }
  | { type: "result"; data: PidAnalysisResult }
  | { type: "error"; message: string };

// ---------------------------------------------------------------------------
// Store state
// ---------------------------------------------------------------------------

/** Wizard step IDs. */
export type WizardStep = "upload" | "analysis" | "recommendations" | "apply";

/** Analysis mode toggle. */
export type AnalysisMode = "wizard" | "quick";
