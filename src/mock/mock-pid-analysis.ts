/**
 * Mock PID analysis data for demo mode.
 *
 * Provides realistic analysis results and AI recommendations
 * for a moderately-tuned ArduCopter quadcopter.
 *
 * @license GPL-3.0-only
 */

import type {
  PidAnalysisResult,
  AiRecommendation,
  FFTAxisResult,
  StepResponseEvent,
  TrackingAxisResult,
  MotorAnalysisResult,
  TimeSample,
  FFTPeak,
} from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a simple sine-ish time series for charting. */
function generateTimeSeries(
  count: number,
  baseValue: number,
  amplitude: number,
  noiseLevel: number,
  startTimeUs: number = 0,
  intervalUs: number = 1000,
): TimeSample[] {
  const samples: TimeSample[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const signal =
      baseValue +
      amplitude * Math.sin(t * Math.PI * 4) +
      (Math.random() - 0.5) * noiseLevel;
    samples.push({ timeUs: startTimeUs + i * intervalUs, value: signal });
  }
  return samples;
}

/** Generate an FFT spectrum with planted peaks. */
function generateSpectrum(
  sampleRate: number,
  peaks: { freq: number; mag: number }[],
): { frequency: number; magnitude: number }[] {
  const bins: { frequency: number; magnitude: number }[] = [];
  const binCount = 256;
  const freqStep = sampleRate / 2 / binCount;
  for (let i = 0; i < binCount; i++) {
    const freq = i * freqStep;
    let mag = 0.001 + Math.random() * 0.002; // noise floor
    for (const peak of peaks) {
      const dist = Math.abs(freq - peak.freq);
      if (dist < freqStep * 8) {
        mag += peak.mag * Math.exp((-dist * dist) / (2 * 15 * 15));
      }
    }
    bins.push({ frequency: freq, magnitude: mag });
  }
  return bins;
}

// ---------------------------------------------------------------------------
// FFT data
// ---------------------------------------------------------------------------

function buildFFTAxis(
  axis: "roll" | "pitch" | "yaw",
  peaks: FFTPeak[],
  sampleRate: number,
): FFTAxisResult {
  const peakConfigs = peaks.map((p) => ({ freq: p.frequency, mag: Math.pow(10, p.magnitudeDb / 20) }));
  return {
    axis,
    spectrum: generateSpectrum(sampleRate, peakConfigs),
    sampleRate,
    peaks,
    noiseFloorDb: -42,
  };
}

const rollFFTPeaks: FFTPeak[] = [
  { frequency: 45, magnitudeDb: -12, zone: "propwash" },
  { frequency: 280, magnitudeDb: -22, zone: "motor" },
];
const pitchFFTPeaks: FFTPeak[] = [
  { frequency: 48, magnitudeDb: -14, zone: "propwash" },
  { frequency: 275, magnitudeDb: -24, zone: "motor" },
];
const yawFFTPeaks: FFTPeak[] = [
  { frequency: 52, magnitudeDb: -18, zone: "propwash" },
  { frequency: 290, magnitudeDb: -28, zone: "motor" },
];

// ---------------------------------------------------------------------------
// Step response data
// ---------------------------------------------------------------------------

function buildStepEvent(
  axis: "roll" | "pitch" | "yaw",
  startTimeUs: number,
  riseTimeMs: number,
  overshootPercent: number,
  settlingTimeMs: number,
  dampingRatio: number,
): StepResponseEvent {
  const durationMs = settlingTimeMs + 50;
  const desired = generateTimeSeries(100, 100, 0, 2, startTimeUs, 1000);
  const actual = generateTimeSeries(100, 100, overshootPercent * 0.8, 5, startTimeUs, 1000);
  return {
    startTimeUs,
    durationMs,
    axis,
    riseTimeMs,
    overshootPercent,
    undershootPercent: 0,
    settlingTimeMs,
    dampingRatio,
    desired,
    actual,
  };
}

// ---------------------------------------------------------------------------
// Tracking data
// ---------------------------------------------------------------------------

function buildTrackingAxis(
  axis: "roll" | "pitch" | "yaw",
  rmsError: number,
  phaseLagMs: number,
  score: number,
): TrackingAxisResult {
  const desired = generateTimeSeries(500, 0, 30, 2, 0, 2000);
  const actual = generateTimeSeries(500, 0, 28, 4, 0, 2000);
  const error = desired.map((d, i) => ({
    timeUs: d.timeUs,
    value: d.value - (actual[i]?.value ?? 0),
  }));
  return { axis, rmsError, phaseLagMs, score, desired, actual, error };
}

// ---------------------------------------------------------------------------
// Motor data
// ---------------------------------------------------------------------------

function buildMotor(
  motorIndex: number,
  averagePwm: number,
  saturationPercent: number,
  oscillationScore: number,
): MotorAnalysisResult {
  return {
    motorIndex,
    averagePwm,
    saturationPercent,
    oscillationScore,
    hasOscillation: oscillationScore > 15,
  };
}

// ---------------------------------------------------------------------------
// Full mock result
// ---------------------------------------------------------------------------

export const MOCK_PID_ANALYSIS_RESULT: PidAnalysisResult = {
  metadata: {
    durationSec: 312,
    gyroSampleRate: 1000,
    rateSampleRate: 400,
    motorSampleCount: 15600,
    fileSizeBytes: 8_421_376,
    logParams: {
      ATC_RAT_RLL_P: 0.135,
      ATC_RAT_RLL_I: 0.135,
      ATC_RAT_RLL_D: 0.004,
      ATC_RAT_RLL_FF: 0,
      ATC_RAT_PIT_P: 0.135,
      ATC_RAT_PIT_I: 0.135,
      ATC_RAT_PIT_D: 0.004,
      ATC_RAT_PIT_FF: 0,
      ATC_RAT_YAW_P: 0.18,
      ATC_RAT_YAW_I: 0.018,
      ATC_RAT_YAW_D: 0,
      ATC_RAT_YAW_FF: 0,
      INS_HNTCH_ENABLE: 0,
      INS_HNTCH_FREQ: 80,
      INS_HNTCH_BW: 20,
    },
  },

  fft: {
    roll: buildFFTAxis("roll", rollFFTPeaks, 1000),
    pitch: buildFFTAxis("pitch", pitchFFTPeaks, 1000),
    yaw: buildFFTAxis("yaw", yawFFTPeaks, 1000),
  },

  stepResponse: {
    roll: [
      buildStepEvent("roll", 50_000_000, 45, 15, 200, 0.62),
      buildStepEvent("roll", 120_000_000, 42, 18, 220, 0.58),
    ],
    pitch: [
      buildStepEvent("pitch", 55_000_000, 48, 14, 210, 0.64),
      buildStepEvent("pitch", 125_000_000, 50, 16, 230, 0.60),
    ],
    yaw: [
      buildStepEvent("yaw", 60_000_000, 55, 8, 180, 0.72),
    ],
  },

  tracking: {
    roll: buildTrackingAxis("roll", 4.2, 12, 72),
    pitch: buildTrackingAxis("pitch", 5.1, 14, 68),
    yaw: buildTrackingAxis("yaw", 2.8, 8, 81),
    overallScore: 74,
  },

  motors: {
    motors: [
      buildMotor(0, 1520, 0.2, 8),
      buildMotor(1, 1535, 0.3, 10),
      buildMotor(2, 1510, 0.1, 18),
      buildMotor(3, 1525, 0.2, 9),
    ],
    imbalanceScore: 12,
    healthScore: 78,
    timeSeries: {
      motors: [
        generateTimeSeries(200, 1520, 40, 15, 0, 5000),
        generateTimeSeries(200, 1535, 35, 12, 0, 5000),
        generateTimeSeries(200, 1510, 50, 20, 0, 5000),
        generateTimeSeries(200, 1525, 38, 14, 0, 5000),
      ],
      motorCount: 4,
    },
  },

  vibration: {
    avgX: 12.5,
    avgY: 14.2,
    avgZ: 22.8,
    maxX: 18.3,
    maxY: 21.7,
    maxZ: 28.4,
    clipCount: 0,
    level: "marginal",
  },

  tuneScore: 65,

  issues: [
    {
      severity: "warning",
      title: "Propwash oscillation detected",
      description:
        "Roll and pitch axes show energy peaks around 45-48 Hz consistent with propwash. " +
        "This typically manifests as oscillations during rapid descents or quick stops.",
      affectedAxis: "roll",
    },
    {
      severity: "warning",
      title: "Pitch tracking error above threshold",
      description:
        "Pitch axis RMS tracking error is 5.1 deg/s (threshold: 4.0). " +
        "The controller is not following desired rates closely enough, " +
        "which can result in sluggish or imprecise pitch response.",
      affectedAxis: "pitch",
    },
  ],
};

// ---------------------------------------------------------------------------
// Mock AI recommendations
// ---------------------------------------------------------------------------

export const MOCK_AI_RECOMMENDATIONS: AiRecommendation[] = [
  {
    id: "rec-1",
    title: "Reduce Roll/Pitch D-term",
    explanation:
      "The FFT shows propwash energy around 45 Hz on both roll and pitch axes. " +
      "The D-term is amplifying this noise. Reducing D from 0.004 to 0.003 should " +
      "cut the oscillation without meaningfully affecting step response damping.",
    priority: "critical",
    confidence: 88,
    parameters: [
      {
        param: "ATC_RAT_RLL_D",
        currentValue: 0.004,
        suggestedValue: 0.003,
        delta: -0.001,
      },
      {
        param: "ATC_RAT_PIT_D",
        currentValue: 0.004,
        suggestedValue: 0.003,
        delta: -0.001,
      },
    ],
  },
  {
    id: "rec-2",
    title: "Increase notch filter bandwidth",
    explanation:
      "The harmonic notch filter bandwidth is set to 20 Hz, which is narrow for " +
      "a propwash peak that spans 40-55 Hz. Widening to 35 Hz will catch more of " +
      "the propwash energy while leaving the useful control frequencies intact.",
    priority: "important",
    confidence: 75,
    parameters: [
      {
        param: "INS_HNTCH_BW",
        currentValue: 20,
        suggestedValue: 35,
        delta: 15,
      },
    ],
  },
  {
    id: "rec-3",
    title: "Fine-tune yaw feedforward",
    explanation:
      "Yaw tracking is decent (score 81) but adding a small feedforward term " +
      "can improve initial response to yaw commands. Start with 0.02 and increase " +
      "if yaw feels lazy during coordinated turns.",
    priority: "optional",
    confidence: 62,
    parameters: [
      {
        param: "ATC_RAT_YAW_FF",
        currentValue: 0,
        suggestedValue: 0.02,
        delta: 0.02,
      },
    ],
  },
];

export const MOCK_AI_SUMMARY =
  "This tune is flyable but has room for improvement. The main issues are " +
  "propwash oscillation on roll/pitch (visible as 45 Hz peaks in the FFT) and " +
  "slightly sluggish pitch tracking. The D-term is amplifying propwash noise, " +
  "and the notch filter is too narrow to catch the full propwash band. " +
  "Motor balance is acceptable with minor oscillation on motor 3. " +
  "Vibration levels are marginal but not clipping. Priority: reduce D-term first, " +
  "then widen the notch filter, then consider yaw feedforward for polish.";
