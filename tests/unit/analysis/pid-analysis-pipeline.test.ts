import { describe, it, expect } from 'vitest';
import { analyzePidLog } from '@/lib/analysis/pid-analysis-pipeline';
import type { DataflashLog, DataflashRecord } from '@/lib/dataflash/parser';

function makeLog(messages: Record<string, DataflashRecord[]>): DataflashLog {
  return {
    formats: new Map(),
    params: new Map([['ATC_RAT_RLL_P', 0.135]]),
    messages: new Map(Object.entries(messages)),
    counts: new Map(Object.entries(messages).map(([name, rows]) => [name, rows.length])),
    bytesRead: 0,
    resyncSkipped: 0,
  };
}

/** Steady hover on four motors at 50 Hz for 10 s. */
function rcouRows(): DataflashRecord[] {
  return Array.from({ length: 500 }, (_, k) => ({ TimeUS: k * 20_000, C1: 1500, C2: 1500, C3: 1500, C4: 1500 }));
}

describe('analyzePidLog with absent log data', () => {
  it('scores nothing and raises no tracking failures when RATE/IMU/RCOU/VIBE are absent', () => {
    const result = analyzePidLog(makeLog({}), 1024);

    expect(result.tuneScore).toBeNull();
    for (const axis of ['roll', 'pitch', 'yaw'] as const) {
      expect(result.tracking[axis].score).toBeNull();
      expect(result.tracking[axis].rmsError).toBeNull();
      expect(result.fft[axis].noiseFloorDb).toBeNull();
    }
    expect(result.tracking.overallScore).toBeNull();
    expect(result.motors.healthScore).toBeNull();
    expect(result.vibration).toBeNull();

    expect(result.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    const missing = result.issues.find((i) => i.title === 'Log data missing');
    expect(missing?.severity).toBe('info');
    for (const type of ['RATE', 'IMU', 'RCOU', 'VIBE']) {
      expect(missing?.description).toContain(type);
    }
  });

  it('scores only the measured parts', () => {
    const result = analyzePidLog(makeLog({ RCOU: rcouRows() }), 1024);

    expect(result.motors.healthScore).toBe(100);
    expect(result.tuneScore).toBe(100);
    const missing = result.issues.find((i) => i.title === 'Log data missing');
    expect(missing?.description).toContain('RATE');
    expect(missing?.description).not.toContain('RCOU');
  });
});
