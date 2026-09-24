import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMspTelemetryState, dispatchMspTelemetry } from '@/lib/protocol/msp-adapter-telemetry';
import { createCallbackStore } from '@/lib/protocol/mavlink-adapter-callbacks';
import { MSP } from '@/lib/protocol/msp/msp-constants';
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav';
import { deriveHudInstruments } from '@/lib/hud-readings';
import { useTelemetryStore } from '@/stores/telemetry-store';
import type { VehicleInfo } from '@/lib/protocol/types';
import type { AttitudeData, PositionData, VfrData } from '@/lib/types/telemetry';

function vehicle(firmwareType: VehicleInfo['firmwareType']): VehicleInfo {
  return { firmwareType, vehicleClass: 'copter' } as VehicleInfo;
}

/** MSP_RAW_GPS: U8 fix, U8 numSat, I32 lat, I32 lon, U16 alt m, U16 speed cm/s, U16 course deci-deg. */
function rawGps(fix: number): Uint8Array {
  const b = new Uint8Array(18);
  const dv = new DataView(b.buffer);
  b[0] = fix;
  b[1] = 12;
  dv.setInt32(2, 473_977_000, true);
  dv.setInt32(6, 85_456_000, true);
  dv.setUint16(10, 450, true);
  dv.setUint16(12, 1200, true); // 12 m/s
  dv.setUint16(14, 900, true); // 90.0 deg
  dv.setUint16(16, 90, true);
  return b;
}

function gpsFix(fix: number, fw: VehicleInfo['firmwareType']): number {
  const cbs = createCallbackStore();
  const cb = vi.fn();
  cbs.gpsCallbacks.push(cb);
  dispatchMspTelemetry(MSP.MSP_RAW_GPS, rawGps(fix), cbs, vehicle(fw), [], createMspTelemetryState());
  return cb.mock.calls[0][0].fixType;
}

describe('MSP_RAW_GPS fix type in MAVLink GPS_FIX_TYPE terms', () => {
  it('maps iNav gpsFixType_e (0 none, 1 2D, 2 3D)', () => {
    expect(gpsFix(0, 'inav')).toBe(1);
    expect(gpsFix(1, 'inav')).toBe(2);
    expect(gpsFix(2, 'inav')).toBe(3);
  });

  it('maps the Betaflight GPS_FIX state bit (0 or 2) to no fix / 3D', () => {
    expect(gpsFix(0, 'betaflight')).toBe(1);
    expect(gpsFix(2, 'betaflight')).toBe(3);
  });
});

describe('MSP_ALTITUDE does not publish speed, heading or throttle', () => {
  it('emits only altitude and climb, so the HUD uses the GPS ground speed and course', () => {
    const cbs = createCallbackStore();
    const vfrCb = vi.fn();
    const posCb = vi.fn();
    cbs.vfrCallbacks.push(vfrCb);
    cbs.positionCallbacks.push(posCb);

    const alt = new Uint8Array(6);
    new DataView(alt.buffer).setInt32(0, 3050, true); // 30.5 m
    new DataView(alt.buffer).setInt16(4, 120, true); // 1.2 m/s
    dispatchMspTelemetry(MSP.MSP_ALTITUDE, alt, cbs, vehicle('inav'), [], createMspTelemetryState());
    dispatchMspTelemetry(MSP.MSP_RAW_GPS, rawGps(2), cbs, vehicle('inav'), [], createMspTelemetryState());

    const vfr: VfrData = vfrCb.mock.calls[0][0];
    expect(vfr.groundspeed).toBeUndefined();
    expect(vfr.heading).toBeUndefined();
    expect(vfr.throttle).toBeUndefined();
    expect(vfr.climb).toBeCloseTo(1.2);

    const position: PositionData = posCb.mock.calls[0][0];
    const hud = deriveHudInstruments({ vfr, position });
    expect(hud.speedMps).toBeCloseTo(12);
    expect(hud.heading).toBeCloseTo(90);
  });
});

describe('MSP leaves quantities it does not carry unreported', () => {
  it('publishes attitude without body rates', () => {
    const cbs = createCallbackStore();
    const cb = vi.fn();
    cbs.attitudeCallbacks.push(cb);
    const att = new Uint8Array(6);
    const dv = new DataView(att.buffer);
    dv.setInt16(0, 125, true); // 12.5 deg
    dv.setInt16(2, -40, true); // -4.0 deg
    dv.setInt16(4, 270, true);
    dispatchMspTelemetry(MSP.MSP_ATTITUDE, att, cbs, vehicle('betaflight'), [], createMspTelemetryState());

    const sample: AttitudeData = cb.mock.calls[0][0];
    expect(sample).toMatchObject({ roll: 12.5, pitch: -4, yaw: 270 });
    expect(sample.rollSpeed).toBeUndefined();
    expect(sample.pitchSpeed).toBeUndefined();
    expect(sample.yawSpeed).toBeUndefined();
  });

  it('publishes the GPS position without a vertical speed', () => {
    const cbs = createCallbackStore();
    const cb = vi.fn();
    cbs.positionCallbacks.push(cb);
    dispatchMspTelemetry(MSP.MSP_RAW_GPS, rawGps(2), cbs, vehicle('inav'), [], createMspTelemetryState());

    const position: PositionData = cb.mock.calls[0][0];
    expect(position.groundSpeed).toBeCloseTo(12);
    expect(position.climbRate).toBeUndefined();
  });

  it('publishes the baro altitude without AMSL, terrain or bottom clearance', () => {
    const cbs = createCallbackStore();
    const cb = vi.fn();
    cbs.altitudeCallbacks.push(cb);
    const alt = new Uint8Array(6);
    new DataView(alt.buffer).setInt32(0, 3050, true); // 30.5 m
    dispatchMspTelemetry(MSP.MSP_ALTITUDE, alt, cbs, vehicle('inav'), [], createMspTelemetryState());

    const sample = cb.mock.calls[0][0];
    expect(sample.altitudeRelative).toBeCloseTo(30.5);
    expect(sample.altitudeAmsl).toBeUndefined();
    expect(sample.altitudeTerrain).toBeUndefined();
    expect(sample.bottomClearance).toBeUndefined();
  });
});

describe('MSP position height above home', () => {
  function altitude(cm: number): Uint8Array {
    const b = new Uint8Array(6);
    new DataView(b.buffer).setInt32(0, cm, true);
    return b;
  }

  function positions(frames: [number, Uint8Array, number][]): PositionData[] {
    const cbs = createCallbackStore();
    const cb = vi.fn();
    cbs.positionCallbacks.push(cb);
    const link = createMspTelemetryState();
    for (const [atMs, payload, command] of frames) {
      vi.setSystemTime(atMs);
      dispatchMspTelemetry(command, payload, cbs, vehicle('inav'), [], link);
    }
    return cb.mock.calls.map((c) => c[0]);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('never reports the MSL GPS altitude as height above home', () => {
    const [pos] = positions([[1_000_000, rawGps(2), MSP.MSP_RAW_GPS]]);
    expect(pos.alt).toBe(450);
    expect(pos.relativeAlt).toBeUndefined();
  });

  it('pairs the fix with a fresh MSP_ALTITUDE estimate', () => {
    const [pos] = positions([
      [1_000_000, altitude(3050), MSP.MSP_ALTITUDE],
      [1_000_200, rawGps(2), MSP.MSP_RAW_GPS],
    ]);
    expect(pos.relativeAlt).toBeCloseTo(30.5);
  });

  it('drops a stale MSP_ALTITUDE estimate', () => {
    const [pos] = positions([
      [1_000_000, altitude(3050), MSP.MSP_ALTITUDE],
      [1_000_000 + 60_000, rawGps(2), MSP.MSP_RAW_GPS],
    ]);
    expect(pos.relativeAlt).toBeUndefined();
  });
});

describe('MSP battery samples', () => {
  it('takes the battery from MSP_BATTERY_STATE only, not the legacy MSP_ANALOG voltage', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    const rcCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    cbs.rcCallbacks.push(rcCb);

    // MSP_BATTERY_STATE: 4S, 16.40 V (u16 centivolts at byte 9).
    const state = new Uint8Array(11);
    const sv = new DataView(state.buffer);
    state[0] = 4;
    state[3] = 164;
    sv.setUint16(4, 120, true);
    sv.setUint16(6, 850, true);
    sv.setUint16(9, 1640, true);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), [], createMspTelemetryState());

    // MSP_ANALOG from the same poll group: 16.4 V, 120 mAh, rssi 512, 8.50 A.
    const analog = new Uint8Array(7);
    const av = new DataView(analog.buffer);
    analog[0] = 164;
    av.setUint16(1, 120, true);
    av.setUint16(3, 512, true);
    av.setInt16(5, 850, true);
    dispatchMspTelemetry(MSP.MSP_ANALOG, analog, cbs, vehicle('betaflight'), [], createMspTelemetryState());

    expect(batteryCb).toHaveBeenCalledTimes(1);
    expect(batteryCb.mock.calls[0][0]).toMatchObject({ voltage: 16.4, current: 8.5, consumed: 120 });
    // MSP_ANALOG only records the RSSI; it publishes no RC sample of its own.
    expect(rcCb).not.toHaveBeenCalled();
  });

  it('reports remaining as not reported on Betaflight: its MSP carries no state of charge', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    // 4S at 16.80 V (a full pack by voltage).
    const state = new Uint8Array(11);
    state[0] = 4;
    new DataView(state.buffer).setUint16(9, 1680, true);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), [], createMspTelemetryState());
    expect(batteryCb.mock.calls[0][0].remaining).toBe(-1);
  });

  it('reads amperage as signed 0.01 A', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    const state = new Uint8Array(11);
    new DataView(state.buffer).setInt16(6, -150, true);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), [], createMspTelemetryState());
    expect(batteryCb.mock.calls[0][0].current).toBe(-1.5);
  });
});

describe('MSP RC samples', () => {
  function analog(rssi: number): Uint8Array {
    const b = new Uint8Array(7);
    new DataView(b.buffer).setUint16(3, rssi, true);
    return b;
  }
  const rc = new Uint8Array([0xdc, 0x05, 0xe8, 0x03]); // 1500, 1000

  it('pairs MSP_RC channels with the last MSP_ANALOG RSSI on the RC_CHANNELS scale', () => {
    const cbs = createCallbackStore();
    const rcCb = vi.fn();
    cbs.rcCallbacks.push(rcCb);
    const link = createMspTelemetryState();
    dispatchMspTelemetry(MSP.MSP_ANALOG, analog(1023), cbs, vehicle('betaflight'), [], link);
    dispatchMspTelemetry(MSP.MSP_RC, rc, cbs, vehicle('betaflight'), [], link);
    expect(rcCb).toHaveBeenCalledTimes(1);
    expect(rcCb.mock.calls[0][0]).toMatchObject({ channels: [1500, 1000], rssi: 254 });
  });

  it('reports RSSI unknown (255), never a dead-link 0, before any RSSI or when none is configured', () => {
    const cbs = createCallbackStore();
    const rcCb = vi.fn();
    cbs.rcCallbacks.push(rcCb);
    const link = createMspTelemetryState();
    dispatchMspTelemetry(MSP.MSP_RC, rc, cbs, vehicle('inav'), [], link);
    dispatchMspTelemetry(MSP.MSP_ANALOG, analog(0), cbs, vehicle('inav'), [], link);
    dispatchMspTelemetry(MSP.MSP_RC, rc, cbs, vehicle('inav'), [], link);
    expect(rcCb.mock.calls.map((c) => c[0].rssi)).toEqual([255, 255]);
  });
});

/** MSP2_INAV_ANALOG, 24 bytes: flags, U16 cV, I16 cA, I32 cW, I32 mAh, I32 mWh, U32 remaining, U8 %, U16 rssi. */
function inavAnalog(batteryState: number, percent: number): Uint8Array {
  const b = new Uint8Array(24);
  const v = new DataView(b.buffer);
  b[0] = (4 << 4) | (batteryState << 2) | 0x01;
  v.setUint16(1, 1590, true);
  v.setInt16(3, 1225, true);
  v.setInt32(5, 19478, true);
  v.setInt32(9, 640, true);
  v.setInt32(13, 9800, true);
  v.setUint32(17, 860, true);
  b[21] = percent;
  v.setUint16(22, 800, true);
  return b;
}

describe('iNav battery samples', () => {
  it('takes remaining from the FC-reported percentage in MSP2_INAV_ANALOG', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    dispatchMspTelemetry(INAV_MSP.MSP2_INAV_ANALOG, inavAnalog(0, 57), cbs, vehicle('inav'), [], createMspTelemetryState());
    expect(batteryCb).toHaveBeenCalledTimes(1);
    expect(batteryCb.mock.calls[0][0]).toMatchObject({ voltage: 15.9, current: 12.25, remaining: 57, consumed: 640 });
  });

  it('reports no data when the FC says no battery is present', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    dispatchMspTelemetry(INAV_MSP.MSP2_INAV_ANALOG, inavAnalog(3, 0), cbs, vehicle('inav'), [], createMspTelemetryState());
    expect(batteryCb.mock.calls[0][0].remaining).toBe(-1);
  });

  it('emits no second sample from MSP_BATTERY_STATE on iNav', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, new Uint8Array(11), cbs, vehicle('inav'), [], createMspTelemetryState());
    expect(batteryCb).not.toHaveBeenCalled();
  });
});

describe('MSP_STATUS_EX system status', () => {
  it('scales whole-percent CPU load to the 0.1 % contract and omits unmeasured power', () => {
    const cbs = createCallbackStore();
    const cb = vi.fn();
    cbs.sysStatusCallbacks.push(cb);
    const payload = new Uint8Array(16);
    new DataView(payload.buffer).setUint16(11, 30, true); // 30 %
    dispatchMspTelemetry(MSP.MSP_STATUS_EX, payload, cbs, vehicle('betaflight'), [], createMspTelemetryState());
    expect(cb.mock.calls[0][0].cpuLoad).toBe(300);
    expect(cb.mock.calls[0][0].voltageMv).toBeUndefined();
    expect(cb.mock.calls[0][0].currentCa).toBeUndefined();
  });

  it('stores the Betaflight arming word with the flag count sent before it', () => {
    useTelemetryStore.getState().clear();
    // No extra mode-flag bytes: count at 16, word at 17, config state at 21.
    const payload = new Uint8Array(22);
    payload[15] = 0;
    payload[16] = 30;
    new DataView(payload.buffer).setUint32(17, (1 << 25) | (1 << 29), true);
    dispatchMspTelemetry(MSP.MSP_STATUS_EX, payload, createCallbackStore(), vehicle('betaflight'), [], createMspTelemetryState());
    const s = useTelemetryStore.getState();
    expect(s.armingFlags).toBe(((1 << 25) | (1 << 29)) >>> 0);
    expect(s.armingFlagCount).toBe(30);
  });
});

describe('MSP_NAV_STATUS', () => {
  beforeEach(() => useTelemetryStore.getState().clear());

  it('stores mode, state and active waypoint action from bytes 0, 1 and 2', () => {
    const payload = new Uint8Array([2, 2, 4, 3, 0, 0, 0]);
    dispatchMspTelemetry(INAV_MSP.MSP_NAV_STATUS, payload, createCallbackStore(), vehicle('inav'), [], createMspTelemetryState());
    const s = useTelemetryStore.getState();
    expect(s.navMode).toBe(2);
    expect(s.navState).toBe(2);
    expect(s.navAction).toBe(4);
  });
});
