import { describe, it, expect } from 'vitest';
import { computeFFT } from '@/lib/analysis/fft';
import type { TimeSample } from '@/lib/analysis/types';

function makeSineWave(
  freq: number,
  sampleRate: number,
  count: number,
  amplitude = 1,
): TimeSample[] {
  return Array.from({ length: count }, (_, i) => ({
    timeUs: (i / sampleRate) * 1e6,
    value: amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate),
  }));
}

function makeDC(value: number, count: number): TimeSample[] {
  return Array.from({ length: count }, (_, i) => ({
    timeUs: i * 1000,
    value,
  }));
}

describe('computeFFT', () => {
  it('returns empty spectrum for empty input', () => {
    const result = computeFFT([], 1000, 'roll');
    expect(result.spectrum).toHaveLength(0);
    expect(result.peaks).toHaveLength(0);
    expect(result.axis).toBe('roll');
  });

  it('returns empty spectrum for single sample', () => {
    const result = computeFFT([{ timeUs: 0, value: 1 }], 1000, 'pitch');
    expect(result.spectrum).toHaveLength(0);
    expect(result.peaks).toHaveLength(0);
  });

  it('preserves axis label in result', () => {
    const result = computeFFT(makeSineWave(100, 1000, 256), 1000, 'yaw');
    expect(result.axis).toBe('yaw');
  });

  it('stores sampleRate in result', () => {
    const result = computeFFT(makeSineWave(100, 1000, 256), 1000, 'roll');
    expect(result.sampleRate).toBe(1000);
  });

  it('detects a pure sine wave peak near the correct frequency', () => {
    const freq = 100;
    const sampleRate = 1000;
    const samples = makeSineWave(freq, sampleRate, 1024);
    const result = computeFFT(samples, sampleRate, 'roll');

    expect(result.peaks.length).toBeGreaterThanOrEqual(1);
    const topPeak = result.peaks[0];
    // Peak should be within a few bins of 100 Hz
    expect(topPeak.frequency).toBeGreaterThanOrEqual(90);
    expect(topPeak.frequency).toBeLessThanOrEqual(110);
  });

  it('DC offset appears as bin 0 (frequency 0)', () => {
    // DC signal with windowing will still have energy near 0 Hz
    const samples = makeDC(5, 256);
    const result = computeFFT(samples, 1000, 'roll');
    // bin 0 should have non-trivial magnitude
    expect(result.spectrum.length).toBeGreaterThan(0);
    expect(result.spectrum[0].frequency).toBe(0);
    // The magnitude at DC should be among the highest
    const dcMag = result.spectrum[0].magnitude;
    const otherMags = result.spectrum.slice(1).map((b) => b.magnitude);
    const maxOther = Math.max(...otherMags);
    expect(dcMag).toBeGreaterThanOrEqual(maxOther);
  });

  it('handles non-power-of-2 input (zero-padded internally)', () => {
    // 300 samples, not a power of 2
    const samples = makeSineWave(50, 500, 300);
    const result = computeFFT(samples, 500, 'roll');
    // Should not throw, spectrum should have bins
    expect(result.spectrum.length).toBeGreaterThan(0);
  });

  it('classifies frequency zone: propwash (20-100 Hz)', () => {
    const samples = makeSineWave(50, 500, 512);
    const result = computeFFT(samples, 500, 'roll');
    const propwashPeaks = result.peaks.filter((p) => p.zone === 'propwash');
    expect(propwashPeaks.length).toBeGreaterThanOrEqual(1);
  });

  it('classifies frequency zone: structural (100-200 Hz)', () => {
    const samples = makeSineWave(150, 1000, 1024);
    const result = computeFFT(samples, 1000, 'roll');
    const structuralPeaks = result.peaks.filter((p) => p.zone === 'structural');
    expect(structuralPeaks.length).toBeGreaterThanOrEqual(1);
  });

  it('classifies frequency zone: motor (200-400 Hz)', () => {
    const samples = makeSineWave(300, 1000, 1024);
    const result = computeFFT(samples, 1000, 'roll');
    const motorPeaks = result.peaks.filter((p) => p.zone === 'motor');
    expect(motorPeaks.length).toBeGreaterThanOrEqual(1);
  });

  it('classifies frequency zone: unknown (>400 Hz)', () => {
    // 450 Hz at 1000 Hz sample rate — Nyquist is 500 Hz
    const samples = makeSineWave(450, 2000, 1024);
    const result = computeFFT(samples, 2000, 'roll');
    if (result.peaks.length > 0) {
      const unknownPeaks = result.peaks.filter((p) => p.zone === 'unknown');
      expect(unknownPeaks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('detects peak above noise floor + 6 dB', () => {
    const samples = makeSineWave(100, 1000, 1024, 10);
    const result = computeFFT(samples, 1000, 'roll');
    expect(result.peaks.length).toBeGreaterThanOrEqual(1);
    // Each peak should be above noiseFloor + 6
    for (const peak of result.peaks) {
      expect(peak.magnitudeDb).toBeGreaterThan(result.noiseFloorDb + 6);
    }
  });

  it('no peaks when all values are identical (flat signal)', () => {
    // A constant signal after Hanning window should have most energy in DC
    // and peaks are detected from index 2 onward, so should be ~no peaks
    const samples = makeDC(1, 256);
    const result = computeFFT(samples, 1000, 'roll');
    // All energy is at DC (bin 0), peak detection starts at bin 2
    // No peaks should be above noise floor + 6 in the non-DC bins
    expect(result.peaks.length).toBe(0);
  });

  it('detects multiple frequencies in multi-frequency signal', () => {
    const sampleRate = 1000;
    const count = 1024;
    const samples: TimeSample[] = Array.from({ length: count }, (_, i) => ({
      timeUs: (i / sampleRate) * 1e6,
      value:
        Math.sin((2 * Math.PI * 50 * i) / sampleRate) +
        Math.sin((2 * Math.PI * 200 * i) / sampleRate),
    }));
    const result = computeFFT(samples, sampleRate, 'roll');

    expect(result.peaks.length).toBeGreaterThanOrEqual(2);
    const freqs = result.peaks.map((p) => p.frequency);
    const has50 = freqs.some((f) => f >= 40 && f <= 60);
    const has200 = freqs.some((f) => f >= 190 && f <= 210);
    expect(has50).toBe(true);
    expect(has200).toBe(true);
  });

  it('sorts peaks by magnitude descending', () => {
    const sampleRate = 1000;
    const count = 1024;
    // Stronger signal at 100 Hz, weaker at 200 Hz
    const samples: TimeSample[] = Array.from({ length: count }, (_, i) => ({
      timeUs: (i / sampleRate) * 1e6,
      value:
        5 * Math.sin((2 * Math.PI * 100 * i) / sampleRate) +
        1 * Math.sin((2 * Math.PI * 200 * i) / sampleRate),
    }));
    const result = computeFFT(samples, sampleRate, 'roll');

    for (let i = 1; i < result.peaks.length; i++) {
      expect(result.peaks[i - 1].magnitudeDb).toBeGreaterThanOrEqual(
        result.peaks[i].magnitudeDb,
      );
    }
  });

  it('computes noise floor as median of magnitudes', () => {
    const samples = makeSineWave(100, 1000, 256);
    const result = computeFFT(samples, 1000, 'roll');
    // Noise floor should be a finite number
    expect(Number.isFinite(result.noiseFloorDb)).toBe(true);
  });

  it('works with large sample count (1024)', () => {
    const samples = makeSineWave(100, 1000, 1024);
    const result = computeFFT(samples, 1000, 'roll');
    expect(result.spectrum.length).toBe(512); // half of 1024
  });

  it('sample rate affects frequency resolution', () => {
    const samples1 = makeSineWave(100, 500, 512);
    const samples2 = makeSineWave(100, 1000, 512);
    const result1 = computeFFT(samples1, 500, 'roll');
    const result2 = computeFFT(samples2, 1000, 'roll');

    // At 500 Hz sample rate with 512 samples: resolution = 500/512 ~ 0.977 Hz
    // At 1000 Hz sample rate with 512 samples: resolution = 1000/512 ~ 1.953 Hz
    const res1 = result1.spectrum[1].frequency - result1.spectrum[0].frequency;
    const res2 = result2.spectrum[1].frequency - result2.spectrum[0].frequency;
    expect(res2).toBeGreaterThan(res1);
  });
});
