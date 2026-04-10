"use client";

/**
 * Vibration Spectrogram — STFT heatmap of accel X/Y/Z.
 *
 * Uses a basic DFT implementation (no external FFT lib needed for the
 * sample rates we have — vibration channel is ≤20 Hz in Phase 1, up to
 * 200 Hz after Phase 29). Renders a canvas heatmap: time on X, frequency
 * on Y, magnitude as color intensity.
 *
 * Phase 17c — vibration analysis.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

// ── FFT (DFT, power-of-2 Cooley-Tukey) ──────────────────────

function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Cooley-Tukey butterfly
  for (let len = 2; len <= n; len *= 2) {
    const halfLen = len / 2;
    const angle = (-2 * Math.PI) / len;
    const wR = Math.cos(angle);
    const wI = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let curR = 1;
      let curI = 0;
      for (let k = 0; k < halfLen; k++) {
        const tR = curR * re[i + k + halfLen] - curI * im[i + k + halfLen];
        const tI = curR * im[i + k + halfLen] + curI * re[i + k + halfLen];
        re[i + k + halfLen] = re[i + k] - tR;
        im[i + k + halfLen] = im[i + k] - tI;
        re[i + k] += tR;
        im[i + k] += tI;
        const newCurR = curR * wR - curI * wI;
        curI = curR * wI + curI * wR;
        curR = newCurR;
      }
    }
  }
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

// ── STFT ─────────────────────────────────────────────────────

interface STFTResult {
  /** Time centers in seconds. */
  times: number[];
  /** Frequency bins in Hz (0 to Nyquist). */
  freqs: number[];
  /** Magnitude matrix [timeIdx][freqIdx] in dB. */
  magnitudes: number[][];
}

function computeSTFT(
  samples: { t: number; v: number }[],
  windowSize: number,
  hopSize: number,
  sampleRate: number,
): STFTResult {
  const n = nextPow2(windowSize);
  const halfN = n / 2;
  const times: number[] = [];
  const magnitudes: number[][] = [];

  // Hann window
  const hann = new Float64Array(windowSize);
  for (let i = 0; i < windowSize; i++) {
    hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (windowSize - 1)));
  }

  for (let start = 0; start + windowSize <= samples.length; start += hopSize) {
    const re = new Float64Array(n);
    const im = new Float64Array(n);

    for (let i = 0; i < windowSize; i++) {
      re[i] = samples[start + i].v * hann[i];
    }

    fft(re, im);

    const mags: number[] = [];
    for (let k = 0; k < halfN; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / windowSize;
      // Convert to dB, clamp floor
      mags.push(20 * Math.log10(Math.max(mag, 1e-10)));
    }
    magnitudes.push(mags);
    times.push(samples[start + Math.floor(windowSize / 2)].t);
  }

  const freqs: number[] = [];
  for (let k = 0; k < halfN; k++) {
    freqs.push((k * sampleRate) / n);
  }

  return { times, freqs, magnitudes };
}

// ── Heatmap canvas renderer ──────────────────────────────────

function renderHeatmap(
  canvas: HTMLCanvasElement,
  stft: STFTResult,
  width: number,
  height: number,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  canvas.width = width;
  canvas.height = height;

  const { times, freqs, magnitudes } = stft;
  if (times.length === 0 || freqs.length === 0) return;

  // Find global min/max for color mapping
  let gMin = Infinity;
  let gMax = -Infinity;
  for (const row of magnitudes) {
    for (const v of row) {
      if (v < gMin) gMin = v;
      if (v > gMax) gMax = v;
    }
  }
  const range = gMax - gMin || 1;

  const cellW = width / times.length;
  const cellH = height / freqs.length;

  for (let ti = 0; ti < times.length; ti++) {
    for (let fi = 0; fi < freqs.length; fi++) {
      const norm = (magnitudes[ti][fi] - gMin) / range; // 0..1
      // Viridis-ish: dark blue → cyan → yellow
      const r = Math.floor(Math.min(255, norm * 510));
      const g = Math.floor(Math.min(255, norm * 255 + (norm > 0.5 ? (norm - 0.5) * 510 : 0)));
      const b = Math.floor(255 * (1 - norm) * 0.8);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(
        ti * cellW,
        height - (fi + 1) * cellH, // flip Y — low freq at bottom
        Math.ceil(cellW),
        Math.ceil(cellH),
      );
    }
  }
}

// ── Component ────────────────────────────────────────────────

type Axis = "X" | "Y" | "Z";
const AXES: Axis[] = ["X", "Y", "Z"];
const AXIS_KEYS: Record<Axis, string> = { X: "vibrationX", Y: "vibrationY", Z: "vibrationZ" };

interface VibrationSpectrogramPanelProps {
  frames: TelemetryFrame[];
}

export function VibrationSpectrogramPanel({ frames }: VibrationSpectrogramPanelProps) {
  const [axis, setAxis] = useState<Axis>("X");

  const samples = useMemo(() => {
    const pts: { t: number; v: number }[] = [];
    const key = AXIS_KEYS[axis];
    for (const f of frames) {
      if (f.channel !== "vibration") continue;
      const d = f.data as Record<string, unknown>;
      const v = d[key];
      if (typeof v === "number" && isFinite(v)) {
        pts.push({ t: f.offsetMs / 1000, v });
      }
    }
    return pts;
  }, [frames, axis]);

  // Estimate sample rate from inter-sample spacing
  const sampleRate = useMemo(() => {
    if (samples.length < 10) return 0;
    const dts: number[] = [];
    for (let i = 1; i < Math.min(samples.length, 200); i++) {
      const dt = samples[i].t - samples[i - 1].t;
      if (dt > 0) dts.push(dt);
    }
    if (dts.length === 0) return 0;
    dts.sort((a, b) => a - b);
    const medianDt = dts[Math.floor(dts.length / 2)];
    return Math.round(1 / medianDt);
  }, [samples]);

  const stft = useMemo(() => {
    if (sampleRate < 2 || samples.length < 32) return null;
    const windowSize = Math.min(nextPow2(sampleRate), 256, samples.length);
    const hopSize = Math.max(1, Math.floor(windowSize / 4));
    return computeSTFT(samples, windowSize, hopSize, sampleRate);
  }, [samples, sampleRate]);

  if (samples.length < 32) {
    return (
      <Card title="Vibration Spectrogram" padding={true}>
        <p className="text-[10px] text-text-tertiary">
          Not enough vibration samples ({samples.length}). Need ≥32 for spectrogram.
        </p>
      </Card>
    );
  }

  return (
    <Card title="Vibration Spectrogram" padding={true}>
      <div className="flex items-center gap-2 mb-2">
        {AXES.map((a) => (
          <button
            key={a}
            onClick={() => setAxis(a)}
            className={`text-[10px] px-2 py-0.5 rounded ${
              axis === a
                ? "bg-accent-primary/20 text-accent-primary"
                : "bg-bg-tertiary text-text-secondary hover:text-text-primary"
            }`}
          >
            {a}
          </button>
        ))}
        <span className="text-[9px] text-text-tertiary ml-2">
          {sampleRate} Hz · {samples.length} samples
        </span>
      </div>
      {stft && <SpectrogramCanvas stft={stft} />}
    </Card>
  );
}

function SpectrogramCanvas({ stft }: { stft: STFTResult }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;
    const w = containerRef.current.clientWidth || 600;
    renderHeatmap(canvasRef.current, stft, w, 160);
  }, [stft]);

  useEffect(() => {
    if (!containerRef.current || !canvasRef.current) return;
    const obs = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && canvasRef.current) renderHeatmap(canvasRef.current, stft, w, 160);
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [stft]);

  const nyquist = stft.freqs.length > 0 ? stft.freqs[stft.freqs.length - 1] : 0;
  const tMin = stft.times.length > 0 ? stft.times[0] : 0;
  const tMax = stft.times.length > 0 ? stft.times[stft.times.length - 1] : 0;

  return (
    <div ref={containerRef} className="w-full relative">
      <canvas ref={canvasRef} className="w-full rounded" style={{ height: 160 }} />
      <div className="flex justify-between text-[9px] font-mono text-text-tertiary mt-0.5">
        <span>{tMin.toFixed(0)}s</span>
        <span>{tMax.toFixed(0)}s</span>
      </div>
      <div className="absolute left-0 top-0 bottom-4 flex flex-col justify-between text-[9px] font-mono text-text-tertiary px-0.5">
        <span>{nyquist.toFixed(0)} Hz</span>
        <span>0 Hz</span>
      </div>
    </div>
  );
}
