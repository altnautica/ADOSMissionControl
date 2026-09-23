/**
 * FFT analysis for PID tuning.
 *
 * Welch-averaged power spectrum (Hanning-windowed radix-2 FFT segments with
 * 50% overlap) and capped peak detection with frequency zone classification.
 * Averaging segments keeps the spectrum bounded to SEGMENT_LENGTH / 2 bins
 * and suppresses the random bin-to-bin scatter a single whole-log
 * periodogram shows, so only real resonances clear the peak threshold.
 *
 * @license GPL-3.0-only
 */

import type { TimeSample, FFTAxisResult, FFTBin, FFTPeak } from "@/lib/analysis/types";

// ---------------------------------------------------------------------------
// Tuning constants
// ---------------------------------------------------------------------------

/** Welch segment length (power of 2). The spectrum has half this many bins. */
export const SEGMENT_LENGTH = 1024;

/** Maximum number of peaks reported per axis. */
export const MAX_PEAKS = 8;

/** Minimum spacing between reported peaks in Hz. */
const MIN_PEAK_SPACING_HZ = 5;

/** A local maximum must clear the median level by this much to count. */
const PEAK_THRESHOLD_DB = 6;

// ---------------------------------------------------------------------------
// Window function
// ---------------------------------------------------------------------------

/** Hanning window coefficients for a segment of `n` samples. */
function hanningWindow(n: number): Float64Array {
  const w = new Float64Array(n);
  if (n === 1) {
    w[0] = 1;
    return w;
  }
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

// ---------------------------------------------------------------------------
// Radix-2 Cooley-Tukey FFT (in-place, iterative)
// ---------------------------------------------------------------------------

/**
 * In-place iterative radix-2 FFT.
 * `re` and `im` are the real and imaginary parts, both length N (power of 2).
 */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length;

  // Bit-reversal permutation
  let j = 0;
  for (let i = 0; i < n - 1; i++) {
    if (i < j) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }

  // Butterfly stages
  for (let size = 2; size <= n; size <<= 1) {
    const halfSize = size >> 1;
    const angleStep = (-2 * Math.PI) / size;
    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < halfSize; k++) {
        const angle = angleStep * k;
        const twRe = Math.cos(angle);
        const twIm = Math.sin(angle);

        const evenIdx = i + k;
        const oddIdx = i + k + halfSize;

        const tRe = twRe * re[oddIdx] - twIm * im[oddIdx];
        const tIm = twRe * im[oddIdx] + twIm * re[oddIdx];

        re[oddIdx] = re[evenIdx] - tRe;
        im[oddIdx] = im[evenIdx] - tIm;
        re[evenIdx] += tRe;
        im[evenIdx] += tIm;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Round up to the next power of 2. */
function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

/** Classify a frequency into a noise zone. */
function classifyFrequency(hz: number): FFTPeak["zone"] {
  if (hz >= 20 && hz <= 100) return "propwash";
  if (hz > 100 && hz <= 200) return "structural";
  if (hz > 200 && hz <= 400) return "motor";
  return "unknown";
}

/** Compute median of a Float64Array. */
function median(arr: Float64Array): number {
  const sorted = Float64Array.from(arr).sort();
  const mid = sorted.length >> 1;
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute the averaged power spectrum of a set of time-domain samples.
 *
 * Inputs longer than SEGMENT_LENGTH are split into 50%-overlapping segments
 * whose power spectra are averaged (Welch). Shorter inputs form one
 * zero-padded segment.
 *
 * @param samples  Time-value pairs (value = gyro rate in deg/s or similar)
 * @param sampleRate  Sample rate in Hz
 * @param axis  Which axis these samples represent
 * @returns Spectrum (at most SEGMENT_LENGTH / 2 bins), up to MAX_PEAKS
 *   distinct peaks, and the noise floor (null when there are no samples)
 */
export function computeFFT(
  samples: TimeSample[],
  sampleRate: number,
  axis: "roll" | "pitch" | "yaw",
): FFTAxisResult {
  if (samples.length < 2) {
    return { axis, spectrum: [], sampleRate, peaks: [], noiseFloorDb: null };
  }

  const n = Math.min(SEGMENT_LENGTH, nextPow2(samples.length));
  const windowLen = Math.min(n, samples.length);
  const window = hanningWindow(windowLen);
  const hop = n >> 1;
  const halfN = n >> 1;

  const re = new Float64Array(n);
  const im = new Float64Array(n);
  const power = new Float64Array(halfN);
  let segments = 0;

  for (let start = 0; start + windowLen <= samples.length; start += hop) {
    re.fill(0);
    im.fill(0);
    for (let i = 0; i < windowLen; i++) {
      re[i] = samples[start + i].value * window[i];
    }
    fftInPlace(re, im);
    for (let i = 0; i < halfN; i++) {
      power[i] += re[i] * re[i] + im[i] * im[i];
    }
    segments++;
    if (windowLen < n) break; // single zero-padded segment
  }

  // Averaged magnitude in dB (same scale as 20*log10(|X| / n) for one segment)
  const freqResolution = sampleRate / n;
  const spectrum: FFTBin[] = new Array(halfN);
  const magnitudes = new Float64Array(halfN);
  const scale = segments * n * n;

  for (let i = 0; i < halfN; i++) {
    const p = power[i] / scale;
    const magDb = p > 0 ? 10 * Math.log10(p) : -120;
    spectrum[i] = { frequency: i * freqResolution, magnitude: magDb };
    magnitudes[i] = magDb;
  }

  const noiseFloorDb = median(magnitudes);
  const threshold = noiseFloorDb + PEAK_THRESHOLD_DB;

  // Candidate peaks: local maxima (±2 bins) above the threshold
  const candidates: FFTPeak[] = [];
  for (let i = 2; i < halfN - 2; i++) {
    const mag = magnitudes[i];
    if (
      mag > threshold &&
      mag > magnitudes[i - 1] &&
      mag > magnitudes[i + 1] &&
      mag > magnitudes[i - 2] &&
      mag > magnitudes[i + 2]
    ) {
      const frequency = i * freqResolution;
      candidates.push({ frequency, magnitudeDb: mag, zone: classifyFrequency(frequency) });
    }
  }

  // Keep the strongest distinct peaks: descending magnitude, minimum spacing, capped
  candidates.sort((a, b) => b.magnitudeDb - a.magnitudeDb);
  const minSpacingHz = Math.max(MIN_PEAK_SPACING_HZ, 3 * freqResolution);
  const peaks: FFTPeak[] = [];
  for (const c of candidates) {
    if (peaks.length >= MAX_PEAKS) break;
    if (peaks.every((p) => Math.abs(p.frequency - c.frequency) >= minSpacingHz)) {
      peaks.push(c);
    }
  }

  return { axis, spectrum, sampleRate, peaks, noiseFloorDb };
}
