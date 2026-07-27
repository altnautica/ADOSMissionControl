import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { routeFrame } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import type { FrameHandlerState } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import { getAllParameters, getParameter, ParamAbsentError, type ParamContext } from '@/lib/protocol/mavlink-adapter-params';
import type { MAVLinkFrame } from '@/lib/protocol/mavlink-parser';
import { createCallbackStore } from '@/lib/protocol/mavlink-adapter-callbacks';
import type { ParameterValue, FirmwareHandler, UnifiedFlightMode } from '@/lib/protocol/types';

// ── Fake transport recording encoded frames ──

interface FakeTransport {
  isConnected: boolean;
  sent: Uint8Array[];
  send: (data: Uint8Array) => void;
}

function makeTransport(connected = true): FakeTransport {
  const sent: Uint8Array[] = [];
  return {
    isConnected: connected,
    sent,
    send: (data: Uint8Array) => {
      sent.push(data);
    },
  };
}

function makeFirmwareHandler(): FirmwareHandler {
  return {
    firmwareType: 'ardupilot-copter',
    vehicleClass: 'copter',
    decodeFlightMode: (): UnifiedFlightMode => 'UNKNOWN',
    encodeFlightMode: () => ({ baseMode: 1, customMode: 0 }),
    getAvailableModes: () => ['STABILIZE'],
    getDefaultMode: () => 'STABILIZE',
    getCapabilities: () => ({}) as never,
    getFirmwareVersion: () => 'ArduCopter',
    mapParameterName: (n: string) => n,
    reverseMapParameterName: (n: string) => n,
  };
}

/**
 * The ParamContext and the FrameHandlerState share the SAME parameterDownload
 * field in the live adapter. The frame handler updates the download and, on
 * completion, nulls it; the getAllParameters promise reads the same slot. These
 * tests build one combined object so both halves operate on one state.
 */
function makeContext(t: FakeTransport): ParamContext & FrameHandlerState {
  return {
    transport: t as never,
    firmwareHandler: makeFirmwareHandler(),
    vehicleInfo: { firmwareType: 'ardupilot-copter', vehicleClass: 'copter' } as never,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    commandQueue: { handleAck: vi.fn() } as never,
    cbs: createCallbackStore(),
    paramCache: new Map(),
    PARAM_CACHE_TTL_MS: 300000,
    parameterDownload: null,
    downloadedParamNames: null,
    onParameter: () => () => {},
    missionUpload: null,
    missionDownload: null,
    rallyUpload: null,
    rallyDownload: null,
    fenceUpload: null,
    fenceDownload: null,
    logListDownload: null,
    logDataDownload: null,
    lastVehicleHeartbeat: Date.now(),
    linkIsLost: false,
    HEARTBEAT_TIMEOUT_MS: 5000,
  };
}

function makeFrame(msgId: number, payload: DataView): MAVLinkFrame {
  return { msgId, systemId: 1, componentId: 1, sequence: 0, payload, timestamp: Date.now() };
}

// PARAM_VALUE (id 22): float32 value, uint16 count, uint16 index, char[16] id, uint8 type.
function makeParamValuePayload(name: string, value: number, index: number, count: number, type = 9): DataView {
  const dv = new DataView(new ArrayBuffer(25));
  dv.setFloat32(0, value, true);
  dv.setUint16(4, count, true);
  dv.setUint16(6, index, true);
  const enc = new TextEncoder().encode(name);
  new Uint8Array(dv.buffer).set(enc.subarray(0, 16), 8);
  dv.setUint8(24, type);
  return dv;
}

function deliverParam(ctx: ParamContext & FrameHandlerState, name: string, value: number, index: number, count: number): void {
  const dv = makeParamValuePayload(name, value, index, count);
  routeFrame(ctx, makeFrame(22, dv), dv);
}

/** Decode a PARAM_REQUEST_READ (id 20) frame's int16 param_index at payload offset 0. */
function readRequestIndex(frame: Uint8Array): number {
  const dv = new DataView(frame.buffer, frame.byteOffset + 10, frame[1]);
  return dv.getInt16(0, true);
}

function isParamRequestRead(frame: Uint8Array): boolean {
  return frame[7] === 20;
}

function isParamRequestList(frame: Uint8Array): boolean {
  return frame[7] === 21;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('parameter batch load', () => {
  it('opens with PARAM_REQUEST_LIST, resolves the full sorted set once every index arrives, and clears both timers', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const setSpy = vi.spyOn(globalThis, 'clearTimeout');

    const promise = getAllParameters(ctx);
    // First wire action is the bulk PARAM_REQUEST_LIST.
    expect(t.sent.length).toBe(1);
    expect(isParamRequestList(t.sent[0])).toBe(true);

    // Deliver the three params out of order; count=3 in each.
    deliverParam(ctx, 'BBB', 2.0, 1, 3);
    deliverParam(ctx, 'CCC', 3.0, 2, 3);
    deliverParam(ctx, 'AAA', 1.0, 0, 3);

    const params: ParameterValue[] = await promise;
    expect(params.map((p) => p.index)).toEqual([0, 1, 2]);
    expect(params.map((p) => p.name)).toEqual(['AAA', 'BBB', 'CCC']);
    expect(params[0].value).toBeCloseTo(1.0);

    // Completion clears both the hard timer and the inactivity timer.
    expect(setSpy).toHaveBeenCalled();
    expect(ctx.parameterDownload).toBeNull();
    setSpy.mockRestore();

    // No timer should remain queued.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('on a 5s inactivity stall re-requests ONLY the missing indices, batched at 50', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = getAllParameters(ctx);

    // Report a 60-param set but only deliver the even indices.
    const total = 60;
    for (let i = 0; i < total; i += 2) {
      deliverParam(ctx, `P${i}`, i, i, total);
    }
    const beforeRetry = t.sent.length;

    // Inactivity fires the missing-index retry.
    vi.advanceTimersByTime(5000);

    const retryFrames = t.sent.slice(beforeRetry).filter(isParamRequestRead);
    // 30 missing indices, capped to a 50-wide batch -> all 30 go out this round.
    expect(retryFrames.length).toBe(30);
    const requested = retryFrames.map(readRequestIndex).sort((a, b) => a - b);
    // Every requested index is an odd (missing) one; no even (received) index re-requested.
    expect(requested.every((idx) => idx % 2 === 1)).toBe(true);
    expect(requested[0]).toBe(1);
    expect(requested[requested.length - 1]).toBe(59);

    // Now deliver the missing ones; the download completes.
    for (let i = 1; i < total; i += 2) {
      deliverParam(ctx, `P${i}`, i, i, total);
    }
    const params = await promise;
    expect(params.length).toBe(total);
    expect(ctx.parameterDownload).toBeNull();
  });

  it('caps the missing re-request at 50 indices per inactivity cycle', () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    void getAllParameters(ctx);

    // 120-param set, deliver none -> 120 missing.
    deliverParam(ctx, 'P0', 0, 0, 120);
    const beforeRetry = t.sent.length;

    vi.advanceTimersByTime(5000);
    const retryFrames = t.sent.slice(beforeRetry).filter(isParamRequestRead);
    expect(retryFrames.length).toBe(50);
  });

  it('gives up and resolves the partial set after the retry cap (six inactivity stalls)', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = getAllParameters(ctx);

    // Deliver index 0 of a 4-param set; 1..3 never arrive.
    deliverParam(ctx, 'P0', 0, 0, 4);

    // Six stalls are tolerated (grace for a lossy link still inside the 120s
    // hard backstop); the seventh stall exceeds the no-progress cap and
    // resolves with whatever has arrived so far.
    for (let cycle = 0; cycle < 7; cycle++) {
      vi.advanceTimersByTime(5000);
    }

    const params = await promise;
    // Only the one received param comes back.
    expect(params.map((p) => p.index)).toEqual([0]);
    expect(ctx.parameterDownload).toBeNull();
  });

  it('resolves with whatever arrived when the 120s hard timeout fires mid-download', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = getAllParameters(ctx);

    // Two of a five-param set arrive, then the FC goes silent.
    deliverParam(ctx, 'BATT_MONITOR', 4.0, 0, 5);
    deliverParam(ctx, 'ARMING_CHECK', 1.0, 3, 5);

    // The hard timer (120s) is the final backstop; jump straight to it.
    vi.advanceTimersByTime(120000);

    const params = await promise;
    expect(params.map((p) => p.index)).toEqual([0, 3]);
    expect(params.map((p) => p.name)).toEqual(['BATT_MONITOR', 'ARMING_CHECK']);
    expect(ctx.parameterDownload).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects when not connected', async () => {
    const t = makeTransport(false);
    const ctx = makeContext(t);
    await expect(getAllParameters(ctx)).rejects.toThrow(/not connected/i);
    expect(t.sent.length).toBe(0);
  });

  it('keeps the download armed (timer re-armed, not resolved) when the count is not yet known', () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    void getAllParameters(ctx);
    const before = t.sent.length;

    // No PARAM_VALUE yet -> total stays 0. The inactivity retry must re-arm.
    // Fix: when the very first request got zero replies, resend
    // PARAM_REQUEST_LIST every 2nd 5s inactivity tick (~10s cadence) instead
    // of looping forever doing nothing until the 120s hard timer resolves
    // with an empty list. Cycle 1 (odd retryCount) keeps waiting; cycle 2
    // (even retryCount) resends the list request once.
    vi.advanceTimersByTime(5000);
    expect(t.sent.length).toBe(before);
    expect(ctx.parameterDownload).not.toBeNull();
    vi.advanceTimersByTime(5000);
    expect(t.sent.filter(isParamRequestList).length - before).toBe(1);
    expect(ctx.parameterDownload).not.toBeNull();
  });
});

describe('parameter fast-fail for board-absent params', () => {
  it('captures the authoritative name set on a complete download and fast-fails a read for a param the board lacks', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = getAllParameters(ctx);
    // A board with just SERIAL0 (2 params).
    deliverParam(ctx, 'SERIAL0_PROTOCOL', 2, 0, 2);
    deliverParam(ctx, 'SERIAL0_BAUD', 57, 1, 2);
    await promise;

    expect(ctx.downloadedParamNames).not.toBeNull();
    expect(ctx.downloadedParamNames?.has('SERIAL0_PROTOCOL')).toBe(true);
    expect(ctx.downloadedParamNames?.has('SERIAL7_PROTOCOL')).toBe(false);

    // A read for a param the board doesn't have rejects IMMEDIATELY with a
    // distinguishable absent error — no PARAM_REQUEST_READ, no 5s timeout.
    const before = t.sent.length;
    await expect(getParameter(ctx, 'SERIAL7_PROTOCOL')).rejects.toBeInstanceOf(ParamAbsentError);
    await expect(getParameter(ctx, 'SERIAL7_PROTOCOL')).rejects.toMatchObject({ code: 'param_absent' });
    expect(t.sent.length).toBe(before);
  });

  it('does a live read (does NOT fast-fail) before the full list has been downloaded', () => {
    const t = makeTransport();
    const ctx = makeContext(t); // downloadedParamNames stays null
    const before = t.sent.length;
    // A live read issues a PARAM_REQUEST_READ and waits (would time out at 5s);
    // the point is it does NOT reject synchronously as absent.
    void getParameter(ctx, 'SERIAL7_PROTOCOL').catch(() => {});
    expect(t.sent.length).toBe(before + 1);
    expect(isParamRequestRead(t.sent[t.sent.length - 1])).toBe(true);
  });

  it('serves a present param from cache with no wire request', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = getAllParameters(ctx);
    deliverParam(ctx, 'SERIAL0_PROTOCOL', 2, 0, 1);
    await promise;

    const before = t.sent.length;
    const r = await getParameter(ctx, 'SERIAL0_PROTOCOL');
    expect(r.value).toBeCloseTo(2);
    expect(t.sent.length).toBe(before);
  });
});
