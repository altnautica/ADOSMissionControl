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
 *
 * `logMessage` and `logEvent` run at wire rate (100-400 Hz on a full ArduPilot
 * stream), so their bump is COALESCED to one per animation frame rather than
 * one per call. The contract these assert is therefore "the bump lands", not
 * "the bump is synchronous": N calls inside one frame must produce exactly one
 * notification. The batching itself is pinned in
 * `state-perf-regressions.test.ts`. `logConnection` / `logCalibration` are
 * operator-rate and stay synchronous.
 */
describe('diagnostics-store re-render + immutability', () => {
  beforeEach(() => {
    useDiagnosticsStore.getState().clear();
  });

  /** Resolve after the next animation frame, when a coalesced bump applies. */
  const nextFrame = (): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    requestAnimationFrame(() => resolve());
    return promise;
  };

  it('bumps _version on logMessage so subscription re-renders', async () => {
    const before = useDiagnosticsStore.getState()._version;
    useDiagnosticsStore.getState().logMessage(30, 'ATTITUDE', 'in', 28);
    expect(useDiagnosticsStore.getState().messageLog.toArray().length).toBe(1);
    await nextFrame();
    expect(useDiagnosticsStore.getState()._version).toBeGreaterThan(before);
  });

  it('coalesces a burst of logMessage calls into one bump', async () => {
    const before = useDiagnosticsStore.getState()._version;
    for (let i = 0; i < 40; i++) {
      useDiagnosticsStore.getState().logMessage(30, 'ATTITUDE', 'in', 28);
    }
    await nextFrame();
    expect(useDiagnosticsStore.getState()._version).toBe(before + 1);
  });

  it('bumps _version on logEvent and appends the event timeline', async () => {
    const before = useDiagnosticsStore.getState()._version;
    useDiagnosticsStore.getState().logEvent('arm', 'armed');
    const timeline = useDiagnosticsStore.getState().eventTimeline.toArray();
    expect(timeline.length).toBe(1);
    expect(timeline[0].type).toBe('arm');
    await nextFrame();
    expect(useDiagnosticsStore.getState()._version).toBeGreaterThan(before);
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
