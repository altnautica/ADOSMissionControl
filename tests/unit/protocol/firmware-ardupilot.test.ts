import { describe, it, expect } from 'vitest';
import {
  ArduCopterHandler,
  ArduPlaneHandler,
  createFirmwareHandler,
  createFirmwareHandlerByType,
  MAV_AUTOPILOT,
  MAV_TYPE,
  ARDUPILOT_CAPABILITIES,
} from '@/lib/protocol/firmware/ardupilot';
import { GenericHandler } from '@/lib/protocol/firmware/generic-handler';

describe('ArduCopterHandler', () => {
  const handler = new ArduCopterHandler();

  it('has firmwareType ardupilot-copter', () => {
    expect(handler.firmwareType).toBe('ardupilot-copter');
  });

  it('has vehicleClass copter', () => {
    expect(handler.vehicleClass).toBe('copter');
  });

  describe('decodeFlightMode', () => {
    const modeMap: [number, string][] = [
      [0, 'STABILIZE'], [1, 'ACRO'], [2, 'ALT_HOLD'], [3, 'AUTO'],
      [4, 'GUIDED'], [5, 'LOITER'], [6, 'RTL'], [7, 'CIRCLE'],
      [9, 'LAND'], [11, 'DRIFT'], [13, 'SPORT'], [14, 'FLIP'],
      [15, 'AUTOTUNE'], [16, 'POSHOLD'], [17, 'BRAKE'], [18, 'THROW'],
      [19, 'AVOID_ADSB'], [21, 'SMART_RTL'], [22, 'FLOWHOLD'],
      [23, 'FOLLOW'], [24, 'ZIGZAG'], [25, 'SYSTEMID'],
      [26, 'HELI_AUTOROTATE'], [27, 'AUTO_RTL'],
    ];

    it.each(modeMap)('decodes custom_mode %i to %s', (customMode, expected) => {
      expect(handler.decodeFlightMode(customMode)).toBe(expected);
    });

    it('returns UNKNOWN for unmapped mode', () => {
      expect(handler.decodeFlightMode(99)).toBe('UNKNOWN');
      expect(handler.decodeFlightMode(8)).toBe('UNKNOWN');
      expect(handler.decodeFlightMode(10)).toBe('UNKNOWN');
    });
  });

  describe('encodeFlightMode', () => {
    it('encodes STABILIZE to custom_mode 0', () => {
      const result = handler.encodeFlightMode('STABILIZE');
      expect(result).toEqual({ baseMode: 1, customMode: 0 });
    });

    it('encodes RTL to custom_mode 6', () => {
      expect(handler.encodeFlightMode('RTL')).toEqual({ baseMode: 1, customMode: 6 });
    });

    it('encodes AUTO_RTL to custom_mode 27', () => {
      expect(handler.encodeFlightMode('AUTO_RTL')).toEqual({ baseMode: 1, customMode: 27 });
    });

    it('throws on unsupported mode', () => {
      expect(() => handler.encodeFlightMode('MANUAL' as any)).toThrow('Unsupported mode for ArduCopter');
    });
  });

  it('getAvailableModes returns all copter modes', () => {
    const modes = handler.getAvailableModes();
    expect(modes).toContain('STABILIZE');
    expect(modes).toContain('AUTO_RTL');
    expect(modes.length).toBe(24);
  });

  it('getDefaultMode returns STABILIZE', () => {
    expect(handler.getDefaultMode()).toBe('STABILIZE');
  });

  it('getCapabilities returns ARDUPILOT_CAPABILITIES', () => {
    expect(handler.getCapabilities()).toBe(ARDUPILOT_CAPABILITIES);
  });

  it('getFirmwareVersion returns ArduCopter', () => {
    expect(handler.getFirmwareVersion()).toBe('ArduCopter');
  });

  it('mapParameterName returns same name', () => {
    expect(handler.mapParameterName('BATT_MONITOR')).toBe('BATT_MONITOR');
  });

  it('reverseMapParameterName returns same name', () => {
    expect(handler.reverseMapParameterName('BATT_MONITOR')).toBe('BATT_MONITOR');
  });
});

describe('ArduPlaneHandler', () => {
  const handler = new ArduPlaneHandler();

  it('has firmwareType ardupilot-plane', () => {
    expect(handler.firmwareType).toBe('ardupilot-plane');
  });

  it('has vehicleClass plane', () => {
    expect(handler.vehicleClass).toBe('plane');
  });

  describe('decodeFlightMode', () => {
    const modeMap: [number, string][] = [
      [0, 'MANUAL'], [1, 'CIRCLE'], [2, 'STABILIZE'], [3, 'TRAINING'],
      [4, 'ACRO'], [5, 'FBWA'], [6, 'FBWB'], [7, 'CRUISE'],
      [8, 'AUTOTUNE'], [10, 'AUTO'], [11, 'RTL'], [12, 'LOITER'],
      [14, 'AVOID_ADSB'], [15, 'GUIDED'], [17, 'QSTABILIZE'],
      [18, 'QHOVER'], [19, 'QLOITER'], [20, 'QLAND'], [21, 'QRTL'],
      [22, 'QAUTOTUNE'], [23, 'QACRO'], [24, 'THERMAL'],
      [13, 'TAKEOFF'], [25, 'LOITER_TO_QLAND'],
    ];

    it.each(modeMap)('decodes custom_mode %i to %s', (customMode, expected) => {
      expect(handler.decodeFlightMode(customMode)).toBe(expected);
    });

    it('returns UNKNOWN for unmapped mode', () => {
      expect(handler.decodeFlightMode(99)).toBe('UNKNOWN');
    });
  });

  describe('encodeFlightMode', () => {
    it('encodes MANUAL to custom_mode 0', () => {
      expect(handler.encodeFlightMode('MANUAL')).toEqual({ baseMode: 1, customMode: 0 });
    });

    it('encodes LOITER to custom_mode 12', () => {
      expect(handler.encodeFlightMode('LOITER')).toEqual({ baseMode: 1, customMode: 12 });
    });

    it('throws on unsupported mode', () => {
      expect(() => handler.encodeFlightMode('POSHOLD' as any)).toThrow('Unsupported mode for ArduPlane');
    });
  });

  it('getAvailableModes returns all plane modes', () => {
    const modes = handler.getAvailableModes();
    expect(modes).toContain('MANUAL');
    expect(modes).toContain('LOITER_TO_QLAND');
    expect(modes.length).toBe(24);
  });

  it('getDefaultMode returns MANUAL', () => {
    expect(handler.getDefaultMode()).toBe('MANUAL');
  });

  it('getCapabilities returns ARDUPILOT_CAPABILITIES', () => {
    expect(handler.getCapabilities()).toBe(ARDUPILOT_CAPABILITIES);
  });
});

describe('createFirmwareHandler', () => {
  it('autopilot=3, type=2 (QUADROTOR) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.QUADROTOR);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, type=1 (FIXED_WING) returns ArduPlaneHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.FIXED_WING);
    expect(h).toBeInstanceOf(ArduPlaneHandler);
  });

  it('autopilot=3, type=22 (VTOL_FIXEDROTOR) returns ArduPlaneHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.VTOL_FIXEDROTOR);
    expect(h).toBeInstanceOf(ArduPlaneHandler);
  });

  it('autopilot=3, type=4 (HELICOPTER) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.HELICOPTER);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, type=13 (HEXAROTOR) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.HEXAROTOR);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, type=14 (OCTOROTOR) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.OCTOROTOR);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, type=15 (TRICOPTER) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.TRICOPTER);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, type=3 (COAXIAL) returns ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, MAV_TYPE.COAXIAL);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=3, unknown vehicle type defaults to ArduCopterHandler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.ARDUPILOTMEGA, 99);
    expect(h).toBeInstanceOf(ArduCopterHandler);
  });

  it('autopilot=12 (PX4) returns px4Handler', () => {
    const h = createFirmwareHandler(MAV_AUTOPILOT.PX4, MAV_TYPE.QUADROTOR);
    expect(h.firmwareType).toBe('px4');
  });

  it('unknown autopilot returns GenericHandler', () => {
    const h = createFirmwareHandler(99, MAV_TYPE.QUADROTOR);
    expect(h).toBeInstanceOf(GenericHandler);
  });
});

describe('createFirmwareHandlerByType', () => {
  it('ardupilot-copter returns ArduCopterHandler', () => {
    expect(createFirmwareHandlerByType('ardupilot-copter')).toBeInstanceOf(ArduCopterHandler);
  });

  it('ardupilot-plane returns ArduPlaneHandler', () => {
    expect(createFirmwareHandlerByType('ardupilot-plane')).toBeInstanceOf(ArduPlaneHandler);
  });

  it('ardupilot-rover falls back to ArduCopterHandler', () => {
    expect(createFirmwareHandlerByType('ardupilot-rover')).toBeInstanceOf(ArduCopterHandler);
  });

  it('ardupilot-sub falls back to ArduCopterHandler', () => {
    expect(createFirmwareHandlerByType('ardupilot-sub')).toBeInstanceOf(ArduCopterHandler);
  });

  it('px4 returns px4Handler', () => {
    const h = createFirmwareHandlerByType('px4');
    expect(h.firmwareType).toBe('px4');
  });

  it('betaflight returns betaflightHandler', () => {
    const h = createFirmwareHandlerByType('betaflight');
    expect(h.firmwareType).toBe('betaflight');
  });

  it('inav returns inavHandler', () => {
    const h = createFirmwareHandlerByType('inav');
    expect(h.firmwareType).toBe('inav');
  });

  it('unknown type returns GenericHandler', () => {
    expect(createFirmwareHandlerByType('nonsense' as any)).toBeInstanceOf(GenericHandler);
  });
});
