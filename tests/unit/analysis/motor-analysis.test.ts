import { describe, it, expect } from 'vitest';
import { analyzeMotors } from '@/lib/analysis/motor-analysis';
import { extractLogData } from '@/lib/analysis/log-extractor';
import type { TimeSample } from '@/lib/analysis/types';
import type { DataFlashLog, DataFlashMessage } from '@/lib/dataflash-parser';

const RATE_HZ = 50;

/** Motor output that follows `pwmAt(seconds)` for `seconds`, sampled at RATE_HZ. */
function series(seconds: number, pwmAt: (t: number) => number): TimeSample[] {
  return Array.from({ length: seconds * RATE_HZ }, (_, k) => {
    const t = k / RATE_HZ;
    return { timeUs: Math.round(t * 1e6), value: pwmAt(t) };
  });
}

/** Spool-up at 1100, ramp to hover, hover at 1500, climb at 1700: no oscillation. */
function normalFlight(t: number): number {
  if (t < 2) return 1100;
  if (t < 3) return 1100 + (t - 2) * 400;
  if (t < 8) return 1500;
  if (t < 9) return 1500 + (t - 8) * 200;
  return 1700;
}

function row(name: string, timeUs: number, fields: Record<string, number | string>): DataFlashMessage {
  return { type: 0, name, timestamp: timeUs, fields: { TimeUS: timeUs, ...fields } };
}

function makeLog(messages: Record<string, DataFlashMessage[]>): DataFlashLog {
  return { formats: new Map(), messages: new Map(Object.entries(messages)) };
}

describe('analyzeMotors oscillation', () => {
  it('does not call ordinary throttle changes over a flight oscillation', () => {
    const motor = series(12, normalFlight);
    const result = analyzeMotors({ motors: [motor, motor, motor, motor], motorCount: 4 });
    expect(result.motors.every((m) => !m.hasOscillation)).toBe(true);
    expect(result.healthScore).toBe(100);
  });

  it('flags a fast oscillation about hover', () => {
    const motor = series(12, (t) => 1500 + 100 * Math.sin(2 * Math.PI * 10 * t));
    const result = analyzeMotors({ motors: [motor], motorCount: 1 });
    expect(result.motors[0].hasOscillation).toBe(true);
  });
});

describe('motor channel selection', () => {
  it('analyses the outputs SERVOn_FUNCTION assigns to motors, in motor order', () => {
    const parm = [
      row('PARM', 0, { Name: 'SERVO1_FUNCTION', Value: 34 }),
      row('PARM', 0, { Name: 'SERVO2_FUNCTION', Value: 33 }),
      row('PARM', 0, { Name: 'SERVO3_FUNCTION', Value: 7 }), // mount tilt
      row('PARM', 0, { Name: 'SERVO4_FUNCTION', Value: 0 }),
    ];
    const rcou = Array.from({ length: 100 }, (_, k) =>
      row('RCOU', k * 20_000, { C1: 1400, C2: 1600, C3: 1900, C4: 1000 }),
    );
    const data = extractLogData(makeLog({ PARM: parm, RCOU: rcou }));
    expect(data.motors.motorCount).toBe(2);
    expect(data.motors.motors.map((m) => m[0].value)).toEqual([1600, 1400]);
  });

  it('leaves unlogged channels out instead of padding empty motors', () => {
    const rcou = Array.from({ length: 100 }, (_, k) =>
      row('RCOU', k * 20_000, { C1: 1500, C2: 1500 }),
    );
    const data = extractLogData(makeLog({ RCOU: rcou }));
    expect(data.motors.motorCount).toBe(2);
    expect(analyzeMotors(data.motors).motors).toHaveLength(2);
  });
});
