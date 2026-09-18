import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { routeFrame } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import type { FrameHandlerState } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import {
  uploadMission,
  downloadMission,
  downloadRallyPoints,
  type MissionContext,
} from '@/lib/protocol/mavlink-adapter-missions';
import type { MAVLinkFrame } from '@/lib/protocol/mavlink-parser';
import { createCallbackStore } from '@/lib/protocol/mavlink-adapter-callbacks';
import { decodeMissionItemInt, decodeMissionRequestInt } from '@/lib/protocol/mavlink-messages';
import type { CommandResult, MissionItem, FirmwareHandler, UnifiedFlightMode } from '@/lib/protocol/types';

// ── Fake transport that records every encoded frame ──

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
    decodeFlightMode: (cm: number): UnifiedFlightMode => (cm === 5 ? 'LOITER' : 'UNKNOWN'),
    encodeFlightMode: () => ({ baseMode: 1, customMode: 0 }),
    getAvailableModes: () => ['STABILIZE'],
    getDefaultMode: () => 'STABILIZE',
    getCapabilities: () => ({}) as never,
    getFirmwareVersion: () => 'ArduCopter',
    mapParameterName: (n: string) => n,
    reverseMapParameterName: (n: string) => n,
  };
}

function makeState(overrides?: Partial<FrameHandlerState>): FrameHandlerState {
  return {
    transport: null,
    firmwareHandler: makeFirmwareHandler(),
    vehicleInfo: { firmwareType: 'ardupilot-copter', vehicleClass: 'copter' } as never,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    commandQueue: { handleAck: vi.fn() } as never,
    cbs: createCallbackStore(),
    paramCache: new Map(),
    parameterDownload: null,
    downloadedParamNames: null,
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
    ...overrides,
  };
}

/**
 * The MissionContext shares the same mutable upload/download fields with the
 * FrameHandlerState in the real adapter. These tests build one combined object
 * and route every field through it so the upload/download promise and the frame
 * handler see the same state, exactly as the live adapter wires them.
 */
function makeContext(t: FakeTransport): MissionContext & FrameHandlerState {
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
    parameterDownload: null,
    downloadedParamNames: null,
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
    sendCommandLong: vi.fn(async (): Promise<CommandResult> => ({ success: true, resultCode: 0, message: 'ok' })),
    onParameter: () => () => {},
    onFencePoint: () => () => {},
    getParameter: vi.fn(async () => ({ value: 0 })),
    setParameter: vi.fn(async () => ({ success: true, resultCode: 0, message: 'ok' })),
  };
}

function makeItem(seq: number, overrides?: Partial<MissionItem>): MissionItem {
  return {
    seq,
    frame: 3,
    command: 16,
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: 128500000 + seq,
    y: 775000000 + seq,
    z: 50 + seq,
    ...overrides,
  };
}

function makeFrame(msgId: number, payload: DataView, systemId = 1): MAVLinkFrame {
  return { msgId, systemId, componentId: 1, sequence: 0, payload, timestamp: Date.now() };
}

// MISSION_REQUEST_INT (51) / legacy MISSION_REQUEST (40) wire layout.
// uint16 seq, uint8 targetSystem, uint8 targetComponent, [uint8 missionType].
function makeRequestPayload(seq: number, missionType = 0): DataView {
  const dv = new DataView(new ArrayBuffer(missionType > 0 ? 5 : 4));
  dv.setUint16(0, seq, true);
  dv.setUint8(2, 1);
  dv.setUint8(3, 1);
  if (missionType > 0) dv.setUint8(4, missionType);
  return dv;
}

// MISSION_COUNT (44): uint16 count, uint8 targetSystem, uint8 targetComponent, [uint8 missionType].
function makeCountPayload(count: number, missionType = 0): DataView {
  const dv = new DataView(new ArrayBuffer(missionType > 0 ? 5 : 4));
  dv.setUint16(0, count, true);
  dv.setUint8(2, 1);
  dv.setUint8(3, 1);
  if (missionType > 0) dv.setUint8(4, missionType);
  return dv;
}

// MISSION_REQUEST / MISSION_REQUEST_INT (40 / 51):
// uint16 seq, uint8 targetSystem, uint8 targetComponent, [uint8 missionType].
function makeMissionRequestPayload(seq: number, missionType = 0): DataView {
  const dv = new DataView(new ArrayBuffer(missionType > 0 ? 5 : 4));
  dv.setUint16(0, seq, true);
  dv.setUint8(2, 1);
  dv.setUint8(3, 1);
  if (missionType > 0) dv.setUint8(4, missionType);
  return dv;
}

// MISSION_ACK (47): uint8 targetSystem, uint8 targetComponent, uint8 type, [uint8 missionType].
function makeAckPayload(type: number, missionType = 0): DataView {
  const dv = new DataView(new ArrayBuffer(missionType > 0 ? 4 : 3));
  dv.setUint8(0, 1);
  dv.setUint8(1, 1);
  dv.setUint8(2, type);
  if (missionType > 0) dv.setUint8(3, missionType);
  return dv;
}

// MISSION_ITEM_INT (73): full 37-byte (or 38 with missionType) layout.
function makeItemIntPayload(item: MissionItem, missionType = 0): DataView {
  const dv = new DataView(new ArrayBuffer(missionType > 0 ? 38 : 37));
  dv.setFloat32(0, item.param1, true);
  dv.setFloat32(4, item.param2, true);
  dv.setFloat32(8, item.param3, true);
  dv.setFloat32(12, item.param4, true);
  dv.setInt32(16, item.x, true);
  dv.setInt32(20, item.y, true);
  dv.setFloat32(24, item.z, true);
  dv.setUint16(28, item.seq, true);
  dv.setUint16(30, item.command, true);
  dv.setUint8(32, 1);
  dv.setUint8(33, 1);
  dv.setUint8(34, item.frame);
  dv.setUint8(35, item.current);
  dv.setUint8(36, item.autocontinue);
  if (missionType > 0) dv.setUint8(37, missionType);
  return dv;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('mission upload state machine', () => {
  it('replies to each MISSION_REQUEST_INT with the matching MISSION_ITEM_INT, then resolves on ACK', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const items = [makeItem(0), makeItem(1), makeItem(2)];

    const promise = uploadMission(ctx, items);
    // First send is MISSION_COUNT (id 44).
    expect(t.sent.length).toBe(1);
    expect(t.sent[0][7]).toBe(44);

    // Walk the FC's per-seq request handshake.
    for (let seq = 0; seq < items.length; seq++) {
      const before = t.sent.length;
      routeFrame(ctx, makeFrame(51, makeRequestPayload(seq)), makeRequestPayload(seq));
      expect(t.sent.length).toBe(before + 1);
      const sentFrame = t.sent[t.sent.length - 1];
      // Each reply must be a MISSION_ITEM_INT (id 73) for exactly this seq.
      expect(sentFrame[7]).toBe(73);
      const decoded = decodeMissionItemInt(
        new DataView(sentFrame.buffer, sentFrame.byteOffset + 10, sentFrame[1]),
      );
      expect(decoded.seq).toBe(seq);
      expect(decoded.x).toBe(items[seq].x);
      expect(decoded.y).toBe(items[seq].y);
      expect(decoded.command).toBe(items[seq].command);
    }

    // FC accepts -> MISSION_ACK type 0.
    routeFrame(ctx, makeFrame(47, makeAckPayload(0)), makeAckPayload(0));
    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.resultCode).toBe(0);
    // State is torn down on completion.
    expect(ctx.missionUpload).toBeNull();
  });

  it('resolves failure when the FC rejects with a non-zero MISSION_ACK type', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);

    const promise = uploadMission(ctx, [makeItem(0)]);
    routeFrame(ctx, makeFrame(51, makeRequestPayload(0)), makeRequestPayload(0));
    routeFrame(ctx, makeFrame(47, makeAckPayload(4)), makeAckPayload(4));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.resultCode).toBe(4);
    expect(ctx.missionUpload).toBeNull();
  });

  it('sends nothing when a MISSION_REQUEST_INT seq is at or past the item count', () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    void uploadMission(ctx, [makeItem(0), makeItem(1)]);
    const baseline = t.sent.length;

    // seq 2 is out of range for a 2-item mission.
    routeFrame(ctx, makeFrame(51, makeRequestPayload(2)), makeRequestPayload(2));
    expect(t.sent.length).toBe(baseline);
  });

  it('answers a legacy MISSION_REQUEST (msg id 40) through the same item path', () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    void uploadMission(ctx, [makeItem(0)]);
    const baseline = t.sent.length;

    routeFrame(ctx, makeFrame(40, makeRequestPayload(0)), makeRequestPayload(0));
    expect(t.sent.length).toBe(baseline + 1);
    const sentFrame = t.sent[t.sent.length - 1];
    expect(sentFrame[7]).toBe(73);
    const decoded = decodeMissionItemInt(
      new DataView(sentFrame.buffer, sentFrame.byteOffset + 10, sentFrame[1]),
    );
    expect(decoded.seq).toBe(0);
  });

  it('fails after 15s of FC silence, clearing state', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = uploadMission(ctx, [makeItem(0)]);

    vi.advanceTimersByTime(15000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/stalled/i);
    expect(ctx.missionUpload).toBeNull();
  });

  it('does not abandon an upload the FC is still driving', async () => {
    // The budget bounds SILENCE, not total transfer time. A flat wall clock
    // abandoned a long mission over a slow radio mid-walk and reported a
    // timeout for an upload still in progress.
    const t = makeTransport();
    const ctx = makeContext(t);
    const items = Array.from({ length: 4 }, (_, i) => makeItem(i));
    const promise = uploadMission(ctx, items);

    for (let seq = 0; seq < items.length; seq++) {
      // Each request lands just inside the window; the total elapses past it.
      vi.advanceTimersByTime(14000);
      const payload = makeMissionRequestPayload(seq);
      routeFrame(ctx, makeFrame(40, payload), payload);
      expect(ctx.missionUpload).not.toBeNull();
    }

    // 56 s in, still alive. Now go silent.
    vi.advanceTimersByTime(15000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect(ctx.missionUpload).toBeNull();
  });

  it('refuses to upload when the transport is disconnected', async () => {
    const t = makeTransport(false);
    const ctx = makeContext(t);
    const result = await uploadMission(ctx, [makeItem(0)]);
    expect(result.success).toBe(false);
    expect(t.sent.length).toBe(0);
  });
});

describe('mission download state machine', () => {
  it('requests seq 0 on MISSION_COUNT, accepts out-of-order items, returns them sorted, and ACKs', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);

    const promise = downloadMission(ctx);
    // First send is MISSION_REQUEST_LIST (id 43).
    expect(t.sent[0][7]).toBe(43);

    // FC reports 3 items.
    routeFrame(ctx, makeFrame(44, makeCountPayload(3)), makeCountPayload(3));
    // Adapter requests seq 0.
    let lastReq = t.sent[t.sent.length - 1];
    expect(lastReq[7]).toBe(51);
    expect(decodeMissionRequestInt(new DataView(lastReq.buffer, lastReq.byteOffset + 10, lastReq[1])).seq).toBe(0);

    // Deliver items OUT OF ORDER: 2, 0, 1.
    const item2 = makeItem(2);
    const item0 = makeItem(0);
    const item1 = makeItem(1);

    routeFrame(ctx, makeFrame(73, makeItemIntPayload(item2)), makeItemIntPayload(item2));
    lastReq = t.sent[t.sent.length - 1];
    // It re-requests the LOWEST missing seq (0), not `received + 1`. Blindly
    // asking for the next number left a permanent hole whenever an item was
    // dropped: the FC never re-sent it and the walk stalled until the deadline
    // handed back a short list.
    expect(decodeMissionRequestInt(new DataView(lastReq.buffer, lastReq.byteOffset + 10, lastReq[1])).seq).toBe(0);

    routeFrame(ctx, makeFrame(73, makeItemIntPayload(item0)), makeItemIntPayload(item0));
    routeFrame(ctx, makeFrame(73, makeItemIntPayload(item1)), makeItemIntPayload(item1));

    const items = await promise;
    expect(items.map((i) => i.seq)).toEqual([0, 1, 2]);
    expect(items[0].x).toBe(item0.x);
    expect(items[2].z).toBeCloseTo(item2.z);

    // Completion must emit a MISSION_ACK (id 47).
    const ackFrame = t.sent[t.sent.length - 1];
    expect(ackFrame[7]).toBe(47);
    expect(ctx.missionDownload).toBeNull();
  });

  it('resolves an empty array when MISSION_COUNT reports zero items', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = downloadMission(ctx);

    routeFrame(ctx, makeFrame(44, makeCountPayload(0)), makeCountPayload(0));
    const items = await promise;
    expect(items).toEqual([]);
    expect(ctx.missionDownload).toBeNull();
  });

  it('REJECTS a truncated download rather than returning the partial set', async () => {
    // A short list is a failed download, never a mission. Resolving it as a
    // success let the planner replace the plan with a truncated one, and the
    // operator could then save it to disk or upload it back.
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = downloadMission(ctx);

    routeFrame(ctx, makeFrame(44, makeCountPayload(3)), makeCountPayload(3));
    // Only seq 1 arrives before the link stalls.
    const item1 = makeItem(1);
    routeFrame(ctx, makeFrame(73, makeItemIntPayload(item1)), makeItemIntPayload(item1));

    vi.advanceTimersByTime(15000);
    await expect(promise).rejects.toThrow(/incomplete: received 1 of 3/);
    expect(ctx.missionDownload).toBeNull();
  });

  it('keeps walking while items keep arriving, past the flat 15s budget', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);
    const promise = downloadMission(ctx);

    routeFrame(ctx, makeFrame(44, makeCountPayload(3)), makeCountPayload(3));
    for (let seq = 0; seq < 3; seq++) {
      vi.advanceTimersByTime(14000);
      const item = makeItem(seq);
      routeFrame(ctx, makeFrame(73, makeItemIntPayload(item)), makeItemIntPayload(item));
    }

    const items = await promise;
    expect(items.map((i) => i.seq)).toEqual([0, 1, 2]);
  });
});

describe('rally point download (missionType 2)', () => {
  it('drives the rally handshake on the mission-type-2 path and resolves sorted points', async () => {
    const t = makeTransport();
    const ctx = makeContext(t);

    const promise = downloadRallyPoints(ctx);
    // MISSION_REQUEST_LIST with the rally mission type.
    expect(t.sent[0][7]).toBe(43);

    // Count = 2 rally points.
    routeFrame(ctx, makeFrame(44, makeCountPayload(2, 2)), makeCountPayload(2, 2));
    let lastReq = t.sent[t.sent.length - 1];
    expect(lastReq[7]).toBe(51); // MISSION_REQUEST_INT for the first rally seq

    // The rally items ride MISSION_ITEM_INT with missionType=2. lat/lon are degE7 -> /1e7.
    const r0 = makeItem(0, { x: 130000000, y: 780000000, z: 100 });
    const r1 = makeItem(1, { x: 131000000, y: 781000000, z: 110 });
    routeFrame(ctx, makeFrame(73, makeItemIntPayload(r1, 2)), makeItemIntPayload(r1, 2));
    routeFrame(ctx, makeFrame(73, makeItemIntPayload(r0, 2)), makeItemIntPayload(r0, 2));

    const points = await promise;
    expect(points.length).toBe(2);
    expect(points[0].lat).toBeCloseTo(13.0);
    expect(points[0].lon).toBeCloseTo(78.0);
    expect(points[0].alt).toBeCloseTo(100);
    expect(points[1].lat).toBeCloseTo(13.1);

    // Completion ACK must carry the rally mission type (4-byte payload).
    const ackFrame = t.sent[t.sent.length - 1];
    expect(ackFrame[7]).toBe(47);
    expect(ackFrame[1]).toBe(4);
    expect(ctx.rallyDownload).toBeNull();
  });
});
