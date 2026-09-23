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
