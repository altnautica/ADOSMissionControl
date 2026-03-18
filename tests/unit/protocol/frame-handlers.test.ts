import { describe, it, expect, beforeEach, vi } from 'vitest';
import { routeFrame, checkLinkState } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import type { FrameHandlerState } from '@/lib/protocol/mavlink-adapter-frame-handlers';
import type { MAVLinkFrame } from '@/lib/protocol/mavlink-parser';
import { createCallbackStore } from '@/lib/protocol/mavlink-adapter-callbacks';
import type { FirmwareHandler, UnifiedFlightMode } from '@/lib/protocol/types';

// ── Helpers ──

function makeFrame(msgId: number, payload: DataView): MAVLinkFrame {
  return {
    msgId,
    systemId: 1,
    componentId: 1,
    sequence: 0,
    payload,
    timestamp: Date.now(),
  };
}

function makeDataView(size: number): DataView {
  return new DataView(new ArrayBuffer(size));
}

function makeFirmwareHandler(overrides?: Partial<FirmwareHandler>): FirmwareHandler {
  return {
    firmwareType: 'ardupilot-copter',
    vehicleClass: 'copter',
    decodeFlightMode: (cm: number) => {
      const map: Record<number, UnifiedFlightMode> = { 0: 'STABILIZE', 5: 'LOITER', 6: 'RTL' };
      return map[cm] ?? 'UNKNOWN';
    },
    encodeFlightMode: () => ({ baseMode: 1, customMode: 0 }),
    getAvailableModes: () => ['STABILIZE'],
    getDefaultMode: () => 'STABILIZE',
    getCapabilities: () => ({} as any),
    getFirmwareVersion: () => 'ArduCopter',
    mapParameterName: (n: string) => n,
    reverseMapParameterName: (n: string) => n,
    ...overrides,
  };
}

function makeState(overrides?: Partial<FrameHandlerState>): FrameHandlerState {
  return {
    transport: null,
    firmwareHandler: makeFirmwareHandler(),
    vehicleInfo: {
      firmwareType: 'ardupilot-copter',
      vehicleClass: 'copter',
    } as any,
    targetSysId: 1,
    targetCompId: 1,
    sysId: 255,
    compId: 190,
    commandQueue: { handleAck: vi.fn() } as any,
    cbs: createCallbackStore(),
    paramCache: new Map(),
    parameterDownload: null,
    missionUpload: null,
    missionDownload: null,
    rallyUpload: null,
    rallyDownload: null,
    logListDownload: null,
    logDataDownload: null,
    lastVehicleHeartbeat: Date.now(),
    linkIsLost: false,
    HEARTBEAT_TIMEOUT_MS: 5000,
    ...overrides,
  };
}

/**
 * Build a heartbeat payload (9 bytes):
 * offset 0: uint32 customMode
 * offset 4: uint8 type
 * offset 5: uint8 autopilot
 * offset 6: uint8 baseMode
 * offset 7: uint8 systemStatus
 * offset 8: uint8 mavlinkVersion
 */
function makeHeartbeatPayload(customMode: number, type: number, baseMode: number, systemStatus = 0): DataView {
  const dv = makeDataView(9);
  dv.setUint32(0, customMode, true);
  dv.setUint8(4, type);
  dv.setUint8(5, 3); // autopilot = ArduPilot
  dv.setUint8(6, baseMode);
  dv.setUint8(7, systemStatus);
  dv.setUint8(8, 3); // mavlink version
  return dv;
}

/**
 * Build a COMMAND_ACK payload (3 bytes):
 * offset 0: uint16 command
 * offset 2: uint8 result
 */
function makeCommandAckPayload(command: number, result: number): DataView {
  const dv = makeDataView(3);
  dv.setUint16(0, command, true);
  dv.setUint8(2, result);
  return dv;
}

/**
 * Build a PARAM_VALUE payload (25 bytes):
 * offset 0: float32 paramValue
 * offset 4: uint16 paramCount
 * offset 6: uint16 paramIndex
 * offset 8: char[16] paramId
 * offset 24: uint8 paramType
 */
function makeParamValuePayload(name: string, value: number, index: number, count: number, type = 9): DataView {
  const dv = makeDataView(25);
  dv.setFloat32(0, value, true);
  dv.setUint16(4, count, true);
  dv.setUint16(6, index, true);
  const enc = new TextEncoder().encode(name);
  const buf = new Uint8Array(dv.buffer);
  buf.set(enc.subarray(0, 16), 8);
  dv.setUint8(24, type);
  return dv;
}

describe('routeFrame — Heartbeat (ID 0)', () => {
  it('fires heartbeat callbacks with mode and armed status', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.heartbeatCallbacks.push(cb);

    const payload = makeHeartbeatPayload(5, 2, 0x80); // LOITER, armed
    const frame = makeFrame(0, payload);
    const p = new DataView(payload.buffer);
    routeFrame(s, frame, p);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        armed: true,
        mode: 'LOITER',
      }),
    );
  });

  it('fires heartbeat with armed=false when baseMode bit 7 is 0', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.heartbeatCallbacks.push(cb);

    const payload = makeHeartbeatPayload(0, 2, 0x00); // STABILIZE, disarmed
    routeFrame(s, makeFrame(0, payload), new DataView(payload.buffer));

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ armed: false, mode: 'STABILIZE' }));
  });

  it('ignores GCS heartbeats (type=6)', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.heartbeatCallbacks.push(cb);

    const payload = makeHeartbeatPayload(0, 6, 0x80); // GCS type
    routeFrame(s, makeFrame(0, payload), new DataView(payload.buffer));

    expect(cb).not.toHaveBeenCalled();
  });

  it('updates lastVehicleHeartbeat timestamp', () => {
    const s = makeState({ lastVehicleHeartbeat: 0 });
    const payload = makeHeartbeatPayload(0, 2, 0x00);
    routeFrame(s, makeFrame(0, payload), new DataView(payload.buffer));
    expect(s.lastVehicleHeartbeat).toBeGreaterThan(0);
  });

  it('includes systemStatus in callback', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.heartbeatCallbacks.push(cb);

    const payload = makeHeartbeatPayload(0, 2, 0x00, 4); // systemStatus=4 (ACTIVE)
    routeFrame(s, makeFrame(0, payload), new DataView(payload.buffer));

    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ systemStatus: 4 }));
  });
});

describe('checkLinkState', () => {
  it('fires linkLost after timeout', () => {
    const s = makeState({
      lastVehicleHeartbeat: Date.now() - 6000,
      linkIsLost: false,
    });
    const lostCb = vi.fn();
    s.cbs.linkLostCallbacks.push(lostCb);

    checkLinkState(s);

    expect(s.linkIsLost).toBe(true);
    expect(lostCb).toHaveBeenCalledOnce();
  });

  it('does not fire linkLost if already lost', () => {
    const s = makeState({
      lastVehicleHeartbeat: Date.now() - 6000,
      linkIsLost: true,
    });
    const lostCb = vi.fn();
    s.cbs.linkLostCallbacks.push(lostCb);

    checkLinkState(s);

    expect(lostCb).not.toHaveBeenCalled();
  });

  it('fires linkRestored on recovery', () => {
    const s = makeState({
      lastVehicleHeartbeat: Date.now(),
      linkIsLost: true,
    });
    const restoredCb = vi.fn();
    s.cbs.linkRestoredCallbacks.push(restoredCb);

    checkLinkState(s);

    expect(s.linkIsLost).toBe(false);
    expect(restoredCb).toHaveBeenCalledOnce();
  });

  it('does not fire if link is healthy and not lost', () => {
    const s = makeState({
      lastVehicleHeartbeat: Date.now(),
      linkIsLost: false,
    });
    const lostCb = vi.fn();
    const restoredCb = vi.fn();
    s.cbs.linkLostCallbacks.push(lostCb);
    s.cbs.linkRestoredCallbacks.push(restoredCb);

    checkLinkState(s);

    expect(lostCb).not.toHaveBeenCalled();
    expect(restoredCb).not.toHaveBeenCalled();
  });
});

describe('routeFrame — COMMAND_ACK (ID 77)', () => {
  it('routes to commandQueue.handleAck', () => {
    const s = makeState();
    const payload = makeCommandAckPayload(400, 0);
    routeFrame(s, makeFrame(77, payload), new DataView(payload.buffer));

    expect(s.commandQueue.handleAck).toHaveBeenCalledWith(400, 0);
  });

  it('passes correct result code', () => {
    const s = makeState();
    const payload = makeCommandAckPayload(246, 4);
    routeFrame(s, makeFrame(77, payload), new DataView(payload.buffer));

    expect(s.commandQueue.handleAck).toHaveBeenCalledWith(246, 4);
  });
});

describe('routeFrame — PARAM_VALUE (ID 22)', () => {
  it('updates paramCache', () => {
    const s = makeState();
    const payload = makeParamValuePayload('BATT_MONITOR', 4.0, 0, 100);
    routeFrame(s, makeFrame(22, payload), new DataView(payload.buffer));

    expect(s.paramCache.has('BATT_MONITOR')).toBe(true);
    expect(s.paramCache.get('BATT_MONITOR')!.value).toBeCloseTo(4.0);
  });

  it('fires parameter callbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.parameterCallbacks.push(cb);

    const payload = makeParamValuePayload('ARMING_CHECK', 1.0, 5, 100);
    routeFrame(s, makeFrame(22, payload), new DataView(payload.buffer));

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'ARMING_CHECK',
        value: expect.closeTo(1.0),
        index: 5,
        count: 100,
      }),
    );
  });
});

describe('routeFrame — telemetry handlers', () => {
  // These handlers all follow the same pattern: decode DataView, call callbacks.
  // We test that routeFrame correctly dispatches to them by checking callbacks fire.

  it('Attitude (30) fires attitudeCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.attitudeCallbacks.push(cb);

    // Attitude payload: uint32 timeBootMs + 6 floats (28 bytes)
    const dv = makeDataView(28);
    dv.setUint32(0, 1000, true);
    dv.setFloat32(4, 0.1, true);  // roll
    dv.setFloat32(8, 0.2, true);  // pitch
    dv.setFloat32(12, 0.3, true); // yaw
    dv.setFloat32(16, 0.01, true); // rollspeed
    dv.setFloat32(20, 0.02, true); // pitchspeed
    dv.setFloat32(24, 0.03, true); // yawspeed

    routeFrame(s, makeFrame(30, dv), dv);

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({
      roll: expect.any(Number),
      pitch: expect.any(Number),
      yaw: expect.any(Number),
    }));
  });

  it('GlobalPosition (33) fires positionCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.positionCallbacks.push(cb);

    // Global position: uint32 timeBootMs + int32 lat + int32 lon + int32 alt + int32 relAlt + int16 vx/vy/vz + uint16 hdg (28 bytes)
    const dv = makeDataView(28);
    dv.setUint32(0, 1000, true);
    dv.setInt32(4, 128500000, true);   // lat
    dv.setInt32(8, 775000000, true);   // lon
    dv.setInt32(12, 100000, true);     // alt
    dv.setInt32(16, 50000, true);      // relative_alt
    dv.setInt16(20, 10, true);         // vx
    dv.setInt16(22, 20, true);         // vy
    dv.setInt16(24, -5, true);         // vz
    dv.setUint16(26, 180, true);       // hdg

    routeFrame(s, makeFrame(33, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('Battery (147) fires batteryCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.batteryCallbacks.push(cb);

    // Battery status payload needs to be large enough
    const dv = makeDataView(42);
    routeFrame(s, makeFrame(147, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('GPSRaw (24) fires gpsCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.gpsCallbacks.push(cb);

    // GPS_RAW_INT: uint64 timeUsec + int32 lat + int32 lon + int32 alt + uint16 eph/epv + uint16 vel + uint16 cog + uint8 fixType + uint8 satVisible (30 bytes)
    const dv = makeDataView(30);
    routeFrame(s, makeFrame(24, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('VfrHud (74) fires vfrCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.vfrCallbacks.push(cb);

    // VFR_HUD: float airspeed + groundspeed + alt + climb + int16 heading + uint16 throttle (20 bytes)
    const dv = makeDataView(20);
    routeFrame(s, makeFrame(74, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('RcChannels (65) fires rcCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.rcCallbacks.push(cb);

    // RC_CHANNELS: uint32 timeBootMs + uint8 chancount + 18x uint16 channels + uint8 rssi (42 bytes)
    const dv = makeDataView(42);
    routeFrame(s, makeFrame(65, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('StatusText (253) fires statusTextCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.statusTextCallbacks.push(cb);

    // STATUSTEXT: uint8 severity + char[50] text (51 bytes)
    const dv = makeDataView(51);
    dv.setUint8(0, 6); // severity = INFO
    const text = new TextEncoder().encode('Hello FC');
    new Uint8Array(dv.buffer).set(text, 1);

    routeFrame(s, makeFrame(253, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });

  it('SysStatus (1) fires sysStatusCallbacks', () => {
    const s = makeState();
    const cb = vi.fn();
    s.cbs.sysStatusCallbacks.push(cb);

    const dv = makeDataView(31);
    routeFrame(s, makeFrame(1, dv), dv);
    expect(cb).toHaveBeenCalledOnce();
  });
});

describe('routeFrame — no crash on unhandled message ID', () => {
  it('silently ignores unknown message IDs', () => {
    const s = makeState();
    const dv = makeDataView(4);
    expect(() => routeFrame(s, makeFrame(9999, dv), dv)).not.toThrow();
  });
});
