/**
 * Vibration analysis — RMS computation, peak detection via FFT, harmonic
 * identification for motor/prop frequencies.
 *
 * Phase 29 — high-rate IMU analysis.
 *
 * @module flight-analysis/vibration
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "../telemetry-recorder";

// ── Types ────────────────────────────────────────────────────

export interface VibrationPeak {
  frequencyHz: number;
  magnitudeDb: number;
  /** If identified as a motor/prop harmonic, which harmonic order. */
  harmonicOrder?: number;
}

export interface VibrationAnalysis {
  /** RMS acceleration per axis in m/s². */
  rmsX: number;
  rmsY: number;
  rmsZ: number;
  /** Overall RMS (sqrt of sum of squares). */
  rmsTotal: number;
  /** Detected frequency peaks (top 10 by magnitude). */
  peaksX: VibrationPeak[];
  peaksY: VibrationPeak[];
  peaksZ: VibrationPeak[];
  /** Estimated sample rate in Hz. */
  sampleRateHz: number;
  /** Number of samples analyzed. */
  sampleCount: number;
  /** Health score 0-100 (100 = perfect, <60 = concerning, <30 = critical). */
  healthScore: number;
  /** Suggested ArduPilot notch filter frequencies. */
  suggestedNotchHz: number[];
}

// ── Analysis ─────────────────────────────────────────────────

/**
 * Analyze vibration data from recorded telemetry frames.
 * Works on both standard vibration channel (~20 Hz) and high-rate
 * imu_highrate channel (~200 Hz).
 */
export function analyzeVibration(frames: TelemetryFrame[]): VibrationAnalysis | undefined {
  // Extract vibration samples (try imu_highrate first, fall back to vibration channel)
  let samples = extractAxis(frames, "imu_highrate", "xacc", "yacc", "zacc");
  if (samples.length < 32) {
    samples = extractAxis(frames, "vibration", "vibrationX", "vibrationY", "vibrationZ");
  }
  if (samples.length < 32) {
    samples = extractAxis(frames, "scaledImu", "xacc", "yacc", "zacc");
  }

  if (samples.length < 32) return undefined;

  // Estimate sample rate
  const sampleRateHz = estimateSampleRate(samples);
  if (sampleRateHz < 2) return undefined;

  // Compute RMS
  const rmsX = rms(samples.map((s) => s.x));
  const rmsY = rms(samples.map((s) => s.y));
  const rmsZ = rms(samples.map((s) => s.z));
  const rmsTotal = Math.sqrt(rmsX * rmsX + rmsY * rmsY + rmsZ * rmsZ);

  // FFT for peak detection
  const peaksX = detectPeaks(samples.map((s) => s.x), sampleRateHz);
  const peaksY = detectPeaks(samples.map((s) => s.y), sampleRateHz);
  const peaksZ = detectPeaks(samples.map((s) => s.z), sampleRateHz);

  // Find dominant frequencies for notch filter suggestions
  const allPeaks = [...peaksX, ...peaksY, ...peaksZ]
    .sort((a, b) => b.magnitudeDb - a.magnitudeDb);
  const suggestedNotchHz = dedupeFrequencies(allPeaks.slice(0, 5).map((p) => p.frequencyHz));

  // Health score: based on total RMS
  // < 15 m/s² = healthy (100), 15-30 = moderate (60-100), 30-60 = concerning (30-60), > 60 = critical (0-30)
  let healthScore = 100;
  if (rmsTotal > 60) healthScore = Math.max(0, 30 - (rmsTotal - 60));
  else if (rmsTotal > 30) healthScore = 30 + (60 - rmsTotal) / 30 * 30;
  else if (rmsTotal > 15) healthScore = 60 + (30 - rmsTotal) / 15 * 40;

  return {
    rmsX: round2(rmsX),
    rmsY: round2(rmsY),
    rmsZ: round2(rmsZ),
    rmsTotal: round2(rmsTotal),
    peaksX: peaksX.slice(0, 5),
    peaksY: peaksY.slice(0, 5),
    peaksZ: peaksZ.slice(0, 5),
    sampleRateHz: Math.round(sampleRateHz),
    sampleCount: samples.length,
    healthScore: Math.round(Math.max(0, Math.min(100, healthScore))),
    suggestedNotchHz,
  };
}

// ── Helpers ──────────────────────────────────────────────────

interface XYZSample {
  t: number; // seconds
  x: number;
  y: number;
  z: number;
}

function extractAxis(
  frames: TelemetryFrame[],
  channel: string,
  xKey: string,
  yKey: string,
  zKey: string,
): XYZSample[] {
  const out: XYZSample[] = [];
  for (const f of frames) {
    if (f.channel !== channel) continue;
    const d = f.data as Record<string, unknown>;
    const x = typeof d[xKey] === "number" ? d[xKey] as number : undefined;
    const y = typeof d[yKey] === "number" ? d[yKey] as number : undefined;
    const z = typeof d[zKey] === "number" ? d[zKey] as number : undefined;
    if (x !== undefined && y !== undefined && z !== undefined) {
      out.push({ t: f.offsetMs / 1000, x, y, z });
    }
  }
  return out;
}

function estimateSampleRate(samples: XYZSample[]): number {
  if (samples.length < 10) return 0;
  const dts: number[] = [];
  for (let i = 1; i < Math.min(samples.length, 500); i++) {
    const dt = samples[i].t - samples[i - 1].t;
    if (dt > 0) dts.push(dt);
  }
  if (dts.length === 0) return 0;
  dts.sort((a, b) => a - b);
  return 1 / dts[Math.floor(dts.length / 2)];
}

function rms(values: number[]): number {
  if (values.length === 0) return 0;
  const sumSq = values.reduce((s, v) => s + v * v, 0);
  return Math.sqrt(sumSq / values.length);
}

// ── FFT peak detection ───────────────────────────────────────

function detectPeaks(values: number[], sampleRate: number): VibrationPeak[] {
  // Pad to next power of 2
  let n = 1;
  while (n < values.length) n *= 2;
  n = Math.min(n, 4096); // Cap at 4096 for performance

  const re = new Float64Array(n);
  const im = new Float64Array(n);

  // Apply Hann window and fill
  const windowLen = Math.min(values.length, n);
  for (let i = 0; i < windowLen; i++) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowLen - 1)));
    re[i] = values[i] * hann;
  }

  // In-place FFT
  fft(re, im);

  // Compute magnitude spectrum (dB)
  const halfN = n / 2;
  const magnitudes: { freq: number; db: number }[] = [];
  for (let k = 1; k < halfN; k++) { // Skip DC (k=0)
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / windowLen;
    const db = 20 * Math.log10(Math.max(mag, 1e-10));
    const freq = (k * sampleRate) / n;
    magnitudes.push({ freq, db });
  }

  // Find local maxima
  const peaks: VibrationPeak[] = [];
  for (let i = 1; i < magnitudes.length - 1; i++) {
    if (magnitudes[i].db > magnitudes[i - 1].db && magnitudes[i].db > magnitudes[i + 1].db) {
      if (magnitudes[i].db > -40) { // Only significant peaks
        peaks.push({
          frequencyHz: round2(magnitudes[i].freq),
          magnitudeDb: round2(magnitudes[i].db),
        });
      }
    }
  }

  // Sort by magnitude, return top peaks
  return peaks.sort((a, b) => b.magnitudeDb - a.magnitudeDb).slice(0, 10);
}

/** Cooley-Tukey radix-2 in-place FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) { j -= m; m >>= 1; }
    j += m;
  }

  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2;
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1, curI = 0;
      for (let k = 0; k < halfLen; k++) {
        const tR = curR * re[i + k + halfLen] - curI * im[i + k + halfLen];
        const tI = curR * im[i + k + halfLen] + curI * re[i + k + halfLen];
        re[i + k + halfLen] = re[i + k] - tR;
        im[i + k + halfLen] = im[i + k] - tI;
        re[i + k] += tR;
        im[i + k] += tI;
        const newR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newR;
      }
    }
  }
}

/** Remove frequencies within ±3 Hz of each other (keep strongest). */
function dedupeFrequencies(freqs: number[]): number[] {
  const out: number[] = [];
  for (const f of freqs) {
    if (!out.some((existing) => Math.abs(existing - f) < 3)) {
      out.push(f);
    }
  }
  return out;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
