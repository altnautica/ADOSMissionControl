import { describe, it, expect } from 'vitest';
import { extractLogData, extractVibration } from '@/lib/analysis/log-extractor';
import { computeFFT } from '@/lib/analysis/fft';
import type { DataFlashLog, DataFlashMessage } from '@/lib/dataflash-parser';

const TICK_HZ = 400;
const TICKS = 8000; // 20 s

function makeLog(messages: Record<string, DataFlashMessage[]>): DataFlashLog {
  return { formats: new Map(), messages: new Map(Object.entries(messages)) };
}

function row(name: string, timeUs: number, fields: Record<string, number>): DataFlashMessage {
  return { type: 0, name, timestamp: timeUs, fields: { TimeUS: timeUs, ...fields } };
}

/**
 * Current-format IMU rows: one row per instance per tick, same TimeUS,
 * tagged by `I`. Instance 0 carries a 150 Hz vibration; the others carry a
 * different bias so interleaving them would add a strong artifact.
 */
function multiImuRows(): DataFlashMessage[] {
  const rows: DataFlashMessage[] = [];
  for (let k = 0; k < TICKS; k++) {
    const t = Math.round((k * 1e6) / TICK_HZ);
    const tone = 10 * Math.sin((2 * Math.PI * 150 * k) / TICK_HZ);
    rows.push(row('IMU', t, { I: 0, GyrX: tone, GyrY: tone, GyrZ: tone }));
    rows.push(row('IMU', t, { I: 1, GyrX: tone + 30, GyrY: tone + 30, GyrZ: tone + 30 }));
    rows.push(row('IMU', t, { I: 2, GyrX: -30, GyrY: -30, GyrZ: -30 }));
  }
  return rows;
}

describe('extractLogData gyro series', () => {
  it('keeps one IMU instance so the series is not interleaved', () => {
    const data = extractLogData(makeLog({ IMU: multiImuRows() }));

    expect(data.gyro.roll).toHaveLength(TICKS);
    expect(data.gyro.roll.every((s, i) => i === 0 || s.timeUs > data.gyro.roll[i - 1].timeUs)).toBe(true);
    expect(data.sampleRates.gyro).toBeCloseTo(TICK_HZ, 0);
  });

  it('puts a resonance at its real frequency', () => {
    const data = extractLogData(makeLog({ IMU: multiImuRows() }));
    const fft = computeFFT(data.gyro.roll, data.sampleRates.gyro, 'roll');

    expect(fft.peaks.length).toBeGreaterThan(0);
    expect(Math.abs(fft.peaks[0].frequency - 150)).toBeLessThan(1);
  });

  it('keeps every row of a log without an instance field', () => {
    const rows = Array.from({ length: 100 }, (_, k) =>
      row('IMU', k * 2500, { GyrX: k, GyrY: 0, GyrZ: 0 }),
    );
    const data = extractLogData(makeLog({ IMU: rows }));
    expect(data.gyro.roll).toHaveLength(100);
  });
});

describe('extractVibration', () => {
  it('returns null when the log has no VIBE messages', () => {
    expect(extractVibration(makeLog({}))).toBeNull();
  });

  it('averages the primary instance and sums the clip counter of every instance', () => {
    const rows: DataFlashMessage[] = [];
    for (let k = 0; k < 10; k++) {
      const t = k * 100_000;
      rows.push(row('VIBE', t, { IMU: 0, VibeX: 5, VibeY: 5, VibeZ: 5, Clip: k < 5 ? 1 : 2 }));
      rows.push(row('VIBE', t, { IMU: 1, VibeX: 40, VibeY: 40, VibeZ: 40, Clip: 3 }));
    }
    const vibe = extractVibration(makeLog({ VIBE: rows }));

    expect(vibe).not.toBeNull();
    expect(vibe?.avgX).toBe(5);
    expect(vibe?.level).toBe('good');
    expect(vibe?.clipCount).toBe(5);
  });

  it('reads the per-IMU clip fields of older logs', () => {
    const rows = [
      row('VIBE', 0, { VibeX: 1, VibeY: 1, VibeZ: 1, Clip0: 0, Clip1: 0, Clip2: 0 }),
      row('VIBE', 100_000, { VibeX: 1, VibeY: 1, VibeZ: 1, Clip0: 2, Clip1: 1, Clip2: 4 }),
    ];
    expect(extractVibration(makeLog({ VIBE: rows }))?.clipCount).toBe(7);
  });
});
