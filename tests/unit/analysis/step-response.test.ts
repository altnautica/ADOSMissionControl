import { describe, it, expect } from 'vitest';
import { extractStepResponses } from '@/lib/analysis/step-response';
import type { TimeSample } from '@/lib/analysis/types';

const RATE_HZ = 400;
const STEP_AT_S = 0.25;
const DURATION_S = 1.5;

/** Desired rate: 0 deg/s, then a step to `target` at STEP_AT_S. */
function desiredStep(target: number): TimeSample[] {
  const count = Math.round(DURATION_S * RATE_HZ);
  return Array.from({ length: count }, (_, i) => {
    const t = i / RATE_HZ;
    return { timeUs: Math.round(t * 1e6), value: t >= STEP_AT_S ? target : 0 };
  });
}

/** Actual rate shaped by `response(secondsSinceStep)` after the step, 0 before. */
function actualResponse(response: (dt: number) => number): TimeSample[] {
  const count = Math.round(DURATION_S * RATE_HZ);
  return Array.from({ length: count }, (_, i) => {
    const t = i / RATE_HZ;
    return { timeUs: Math.round(t * 1e6), value: t >= STEP_AT_S ? response(t - STEP_AT_S) : 0 };
  });
}

/** First-order rise toward `final` with a 20 ms time constant. */
const firstOrder = (final: number) => (dt: number) => final * (1 - Math.exp(-dt / 0.02));

/** Under-damped rise toward `final` that peaks about 20% above it. */
const ringing = (final: number) => (dt: number) =>
  final * (1 - Math.exp(-dt / 0.03) * Math.cos(2 * Math.PI * 8 * dt));

describe('extractStepResponses overshoot and undershoot', () => {
  it('reports a response that stops short of the target as undershoot, not overshoot', () => {
    const [event] = extractStepResponses(desiredStep(100), actualResponse(firstOrder(80)), 'roll');

    expect(event).toBeDefined();
    expect(event.overshootPercent).toBe(0);
    expect(event.undershootPercent).toBeGreaterThan(19);
    expect(event.undershootPercent).toBeLessThan(21);
  });

  it('reports an axis that never moves as full undershoot without an undamped damping ratio', () => {
    const [event] = extractStepResponses(desiredStep(100), actualResponse(() => 0), 'roll');

    expect(event.overshootPercent).toBe(0);
    expect(event.undershootPercent).toBe(100);
    expect(event.dampingRatio).toBeGreaterThan(0);
  });

  it('measures real overshoot past the target', () => {
    const [event] = extractStepResponses(desiredStep(100), actualResponse(ringing(100)), 'pitch');

    expect(event.undershootPercent).toBe(0);
    expect(event.overshootPercent).toBeGreaterThan(10);
    expect(event.dampingRatio).toBeLessThan(1);
  });

  it('applies the step direction to negative steps', () => {
    const [short] = extractStepResponses(desiredStep(-100), actualResponse(firstOrder(-80)), 'yaw');
    expect(short.overshootPercent).toBe(0);
    expect(short.undershootPercent).toBeGreaterThan(19);

    const [over] = extractStepResponses(desiredStep(-100), actualResponse(ringing(-100)), 'yaw');
    expect(over.undershootPercent).toBe(0);
    expect(over.overshootPercent).toBeGreaterThan(10);
  });
});

describe('extractStepResponses detection', () => {
  it('anchors a step at the last sample before the desired rate moves', () => {
    const [event] = extractStepResponses(desiredStep(100), actualResponse(firstOrder(100)), 'roll');
    expect(event.startTimeUs).toBe(Math.round(((STEP_AT_S * RATE_HZ - 1) / RATE_HZ) * 1e6));
  });

  it('detects an acceleration-limited stick step and targets the end of the ramp', () => {
    // 1100 deg/s^2 ramp from 0 to 200 deg/s: under 3 deg/s per 400 Hz sample.
    const accel = 1100;
    const rampEnd = STEP_AT_S + 200 / accel;
    const count = Math.round(DURATION_S * RATE_HZ);
    const desired: TimeSample[] = Array.from({ length: count }, (_, i) => {
      const t = i / RATE_HZ;
      const value = t < STEP_AT_S ? 0 : t < rampEnd ? accel * (t - STEP_AT_S) : 200;
      return { timeUs: Math.round(t * 1e6), value };
    });
    const actual = desired.map((s) => ({ ...s }));
    const events = extractStepResponses(desired, actual, 'roll');

    expect(events).toHaveLength(1);
    expect(events[0].startTimeUs).toBeLessThanOrEqual(Math.round(STEP_AT_S * 1e6));
    expect(events[0].startTimeUs).toBeGreaterThan(Math.round((STEP_AT_S - 0.01) * 1e6));
    expect(events[0].overshootPercent).toBe(0);
    expect(events[0].undershootPercent).toBe(0);
  });

  it('detects steps in a 10 Hz RATE log', () => {
    const hz = 10;
    const series = (target: number): TimeSample[] =>
      Array.from({ length: 30 }, (_, i) => ({
        timeUs: Math.round((i / hz) * 1e6),
        value: i >= 10 ? target : 0,
      }));
    expect(extractStepResponses(series(100), series(100), 'pitch')).toHaveLength(1);
  });
});
