import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dispatchMspTelemetry } from '@/lib/protocol/msp-adapter-telemetry';
import { createCallbackStore } from '@/lib/protocol/mavlink-adapter-callbacks';
import { MSP } from '@/lib/protocol/msp/msp-constants';
import { INAV_MSP } from '@/lib/protocol/msp/msp-decoders-inav';
import { deriveHudInstruments } from '@/lib/hud-readings';
import { useTelemetryStore } from '@/stores/telemetry-store';
import type { VehicleInfo } from '@/lib/protocol/types';
import type { PositionData, VfrData } from '@/lib/types/telemetry';

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
  dispatchMspTelemetry(MSP.MSP_RAW_GPS, rawGps(fix), cbs, vehicle(fw), []);
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
    dispatchMspTelemetry(MSP.MSP_ALTITUDE, alt, cbs, vehicle('inav'), []);
    dispatchMspTelemetry(MSP.MSP_RAW_GPS, rawGps(2), cbs, vehicle('inav'), []);

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
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), []);

    // MSP_ANALOG from the same poll group: 16.4 V, 120 mAh, rssi 512, 8.50 A.
    const analog = new Uint8Array(7);
    const av = new DataView(analog.buffer);
    analog[0] = 164;
    av.setUint16(1, 120, true);
    av.setUint16(3, 512, true);
    av.setInt16(5, 850, true);
    dispatchMspTelemetry(MSP.MSP_ANALOG, analog, cbs, vehicle('betaflight'), []);

    expect(batteryCb).toHaveBeenCalledTimes(1);
    expect(batteryCb.mock.calls[0][0]).toMatchObject({ voltage: 16.4, current: 8.5, consumed: 120 });
    expect(rcCb).toHaveBeenCalledTimes(1);
  });

  it('reports remaining as not reported on Betaflight: its MSP carries no state of charge', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    // 4S at 16.80 V (a full pack by voltage).
    const state = new Uint8Array(11);
    state[0] = 4;
    new DataView(state.buffer).setUint16(9, 1680, true);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), []);
    expect(batteryCb.mock.calls[0][0].remaining).toBe(-1);
  });

  it('reads amperage as signed 0.01 A', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    const state = new Uint8Array(11);
    new DataView(state.buffer).setInt16(6, -150, true);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, state, cbs, vehicle('betaflight'), []);
    expect(batteryCb.mock.calls[0][0].current).toBe(-1.5);
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
    dispatchMspTelemetry(INAV_MSP.MSP2_INAV_ANALOG, inavAnalog(0, 57), cbs, vehicle('inav'), []);
    expect(batteryCb).toHaveBeenCalledTimes(1);
    expect(batteryCb.mock.calls[0][0]).toMatchObject({ voltage: 15.9, current: 12.25, remaining: 57, consumed: 640 });
  });

  it('reports no data when the FC says no battery is present', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    dispatchMspTelemetry(INAV_MSP.MSP2_INAV_ANALOG, inavAnalog(3, 0), cbs, vehicle('inav'), []);
    expect(batteryCb.mock.calls[0][0].remaining).toBe(-1);
  });

  it('emits no second sample from MSP_BATTERY_STATE on iNav', () => {
    const cbs = createCallbackStore();
    const batteryCb = vi.fn();
    cbs.batteryCallbacks.push(batteryCb);
    dispatchMspTelemetry(MSP.MSP_BATTERY_STATE, new Uint8Array(11), cbs, vehicle('inav'), []);
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
    dispatchMspTelemetry(MSP.MSP_STATUS_EX, payload, cbs, vehicle('betaflight'), []);
    expect(cb.mock.calls[0][0].cpuLoad).toBe(300);
    expect(cb.mock.calls[0][0].voltageMv).toBeUndefined();
    expect(cb.mock.calls[0][0].currentCa).toBeUndefined();
  });
});

describe('MSP_NAV_STATUS', () => {
  beforeEach(() => useTelemetryStore.getState().clear());

  it('stores mode, state and active waypoint action from bytes 0, 1 and 2', () => {
    const payload = new Uint8Array([2, 2, 4, 3, 0, 0, 0]);
    dispatchMspTelemetry(INAV_MSP.MSP_NAV_STATUS, payload, createCallbackStore(), vehicle('inav'), []);
    const s = useTelemetryStore.getState();
    expect(s.navMode).toBe(2);
    expect(s.navState).toBe(2);
    expect(s.navAction).toBe(4);
  });
});
