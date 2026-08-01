import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useDiagnosticsStore } from '@/stores/diagnostics-store';

/**
 * logMessage runs on every inbound frame regardless of whether the rate panel
 * is mounted (updateRates only runs while it is open). The per-message
 * timestamps array must therefore be bounded at push time, not by updateRates.
 */
describe('diagnostics-store message-rate timestamp bounds', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useDiagnosticsStore.getState().clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caps a high-rate stream at the hard ceiling without updateRates', () => {
    vi.setSystemTime(1_000_000);
    // 5000 pushes at the same instant — far above any real window count.
    for (let i = 0; i < 5000; i++) {
      useDiagnosticsStore.getState().logMessage(30, 'ATTITUDE', 'in', 28);
    }
    const entry = useDiagnosticsStore.getState().messageRates.get(30);
    expect(entry).toBeDefined();
    expect(entry!.timestamps.length).toBeLessThanOrEqual(600);
    expect(entry!.timestamps.length).toBeGreaterThan(0);
  });

  it('prunes timestamps older than the rate window at push time', () => {
    vi.setSystemTime(1_000_000);
    for (let i = 0; i < 50; i++) {
      useDiagnosticsStore.getState().logMessage(33, 'GLOBAL_POSITION_INT', 'in', 28);
    }
    // Advance well past the 5 s rate window and push once more.
    vi.setSystemTime(1_000_000 + 60_000);
    useDiagnosticsStore.getState().logMessage(33, 'GLOBAL_POSITION_INT', 'in', 28);

    const entry = useDiagnosticsStore.getState().messageRates.get(33);
    expect(entry).toBeDefined();
    // The 50 stale timestamps are dropped on the next push; only the fresh one
    // survives, so a stopped-then-resumed stream does not pin a stale array.
    expect(entry!.timestamps.length).toBe(1);
    expect(entry!.timestamps[0]).toBe(1_000_000 + 60_000);
  });
});

/**
 * logMessage/logEvent/logConnection/logCalibration must bump _version so
 * selectors re-read the mutated ring buffers, and must not mutate the live
 * state arrays in place before copying them.
 */
describe('diagnostics-store re-render + immutability', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clear();
  });

  it('bumps _version on logMessage so subscription re-renders', () => {
    const before = useDiagnosticsStore.getState()._version;
    useDiagnosticsStore.getState().logMessage(30, 'ATTITUDE', 'in', 28);
    const after = useDiagnosticsStore.getState()._version;
    expect(after).toBeGreaterThan(before);
    expect(useDiagnosticsStore.getState().messageLog.toArray().length).toBe(1);
  });

  it('bumps _version on logEvent and appends the event timeline', () => {
    const before = useDiagnosticsStore.getState()._version;
    useDiagnosticsStore.getState().logEvent('arm', 'armed');
    const after = useDiagnosticsStore.getState()._version;
    expect(after).toBeGreaterThan(before);
    const timeline = useDiagnosticsStore.getState().eventTimeline.toArray();
    expect(timeline.length).toBe(1);
    expect(timeline[0].type).toBe('arm');
  });

  it('does not mutate the live connectionLog array before copying', () => {
    useDiagnosticsStore.getState().logConnection('connect', 'serial');
    // A held reference from before the mutation must not see the new entry:
    // the fix copies first, then pushes.
    const ref = useDiagnosticsStore.getState().connectionLog;
    const refLen = ref.length;
    useDiagnosticsStore.getState().logConnection('error', 'link lost');
    expect(ref.length).toBe(refLen);
    expect(useDiagnosticsStore.getState().connectionLog.length).toBe(refLen + 1);
  });

  it('caps connectionLog at MAX_CONNECTION_LOG (500)', () => {
    for (let i = 0; i < 600; i++) {
      useDiagnosticsStore.getState().logConnection('error', `err ${i}`);
    }
    expect(useDiagnosticsStore.getState().connectionLog.length).toBe(500);
  });

  it('copies before mutating calibrationHistory', () => {
    useDiagnosticsStore.getState().logCalibration('mag', 'success');
    const ref = useDiagnosticsStore.getState().calibrationHistory;
    const refLen = ref.length;
    useDiagnosticsStore.getState().logCalibration('mag', 'failed');
    expect(ref.length).toBe(refLen);
    expect(useDiagnosticsStore.getState().calibrationHistory.length).toBe(refLen + 1);
  });
});
