import { describe, it, expect } from 'vitest';
import {
  VIRTUAL_PARAMS,
  getParamsByReadCmd,
  getReadCmdsForParams,
} from '@/lib/protocol/msp/virtual-params';

describe('Virtual Params Registry', () => {
  it('registry exists and has entries', () => {
    expect(VIRTUAL_PARAMS.size).toBeGreaterThan(0);
  });

  it('total param count is approximately 105', () => {
    expect(VIRTUAL_PARAMS.size).toBeGreaterThanOrEqual(100);
    expect(VIRTUAL_PARAMS.size).toBeLessThanOrEqual(140);
  });

  // ── PID params ──
  describe('PID params', () => {
    const PID_AXES = ['ROLL', 'PITCH', 'YAW', 'ALT', 'POS', 'POSR', 'NAVR', 'LEVEL', 'MAG', 'VEL'];
    const PID_FIELDS = ['P', 'I', 'D'];

    for (const axis of PID_AXES) {
      for (const field of PID_FIELDS) {
        const name = `BF_PID_${axis}_${field}`;
        it(`${name} exists`, () => {
          expect(VIRTUAL_PARAMS.has(name)).toBe(true);
        });
      }
    }

    it('all 30 PID params exist', () => {
      let count = 0;
      for (const axis of PID_AXES) {
        for (const field of PID_FIELDS) {
          if (VIRTUAL_PARAMS.has(`BF_PID_${axis}_${field}`)) count++;
        }
      }
      expect(count).toBe(30);
    });
  });

  // ── RC Tuning params ──
  describe('RC Tuning params', () => {
    const rcParams = [
      'BF_RC_RATE', 'BF_RC_EXPO', 'BF_ROLL_RATE', 'BF_PITCH_RATE', 'BF_YAW_RATE',
      'BF_THROTTLE_MID', 'BF_THROTTLE_EXPO', 'BF_RC_YAW_EXPO', 'BF_RC_YAW_RATE',
      'BF_RC_PITCH_RATE', 'BF_RC_PITCH_EXPO', 'BF_THROTTLE_LIMIT_TYPE',
      'BF_THROTTLE_LIMIT_PERCENT', 'BF_ROLL_RATE_LIMIT', 'BF_PITCH_RATE_LIMIT',
      'BF_YAW_RATE_LIMIT', 'BF_RATES_TYPE',
    ];

    for (const name of rcParams) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Motor config params ──
  describe('Motor config params', () => {
    const params = [
      'BF_MOTOR_MIN_THROTTLE', 'BF_MOTOR_MAX_THROTTLE', 'BF_MOTOR_MIN_COMMAND',
      'BF_MOTOR_POLES', 'BF_MOTOR_USE_DSHOT_TELEMETRY',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Battery config params ──
  describe('Battery config params', () => {
    const params = [
      'BF_BATT_MIN_CELL', 'BF_BATT_MAX_CELL', 'BF_BATT_WARNING_CELL',
      'BF_BATT_CAPACITY', 'BF_BATT_VOLTAGE_METER_SOURCE', 'BF_BATT_CURRENT_METER_SOURCE',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Filter config params ──
  describe('Filter config params', () => {
    const params = [
      'BF_GYRO_LPF_HZ', 'BF_DTERM_LPF_HZ', 'BF_YAW_LPF_HZ',
      'BF_GYRO_NOTCH_HZ', 'BF_GYRO_NOTCH_CUTOFF',
      'BF_DTERM_NOTCH_HZ', 'BF_DTERM_NOTCH_CUTOFF',
      'BF_GYRO_NOTCH2_HZ', 'BF_GYRO_NOTCH2_CUTOFF',
      'BF_DTERM_LPF_TYPE', 'BF_GYRO_HARDWARE_LPF',
      'BF_GYRO_LPF2_HZ', 'BF_GYRO_LPF_TYPE', 'BF_GYRO_LPF2_TYPE',
      'BF_DTERM_LPF2_HZ', 'BF_DTERM_LPF2_TYPE',
      'BF_DYN_NOTCH_Q', 'BF_DYN_NOTCH_MIN_HZ', 'BF_DYN_NOTCH_MAX_HZ', 'BF_DYN_NOTCH_COUNT',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Failsafe params ──
  describe('Failsafe params', () => {
    const params = [
      'BF_FS_DELAY', 'BF_FS_OFF_DELAY', 'BF_FS_THROTTLE',
      'BF_FS_SWITCH_MODE', 'BF_FS_THROTTLE_LOW_DELAY', 'BF_FS_PROCEDURE',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── GPS params ──
  describe('GPS params', () => {
    const params = [
      'BF_GPS_PROVIDER', 'BF_GPS_SBAS_MODE', 'BF_GPS_AUTO_CONFIG',
      'BF_GPS_AUTO_BAUD', 'BF_GPS_HOME_POINT_ONCE', 'BF_GPS_USE_GALILEO',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── GPS Rescue params ──
  describe('GPS Rescue params', () => {
    const params = [
      'BF_GPS_RESCUE_ANGLE', 'BF_GPS_RESCUE_INITIAL_ALT', 'BF_GPS_RESCUE_DESCENT_DIST',
      'BF_GPS_RESCUE_GROUND_SPEED', 'BF_GPS_RESCUE_THROTTLE_MIN', 'BF_GPS_RESCUE_THROTTLE_MAX',
      'BF_GPS_RESCUE_THROTTLE_HOVER', 'BF_GPS_RESCUE_SANITY_CHECKS', 'BF_GPS_RESCUE_MIN_SATS',
      'BF_GPS_RESCUE_ASCEND_RATE', 'BF_GPS_RESCUE_DESCEND_RATE',
      'BF_GPS_RESCUE_ALLOW_ARMING_NO_FIX', 'BF_GPS_RESCUE_ALTITUDE_MODE',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Blackbox params ──
  describe('Blackbox params', () => {
    const params = [
      'BF_BLACKBOX_DEVICE', 'BF_BLACKBOX_RATE_NUM', 'BF_BLACKBOX_RATE_DENOM',
      'BF_BLACKBOX_P_DENOM', 'BF_BLACKBOX_SAMPLE_RATE',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── VTX params ──
  describe('VTX params', () => {
    const params = [
      'BF_VTX_TYPE', 'BF_VTX_BAND', 'BF_VTX_CHANNEL', 'BF_VTX_POWER',
      'BF_VTX_PIT_MODE', 'BF_VTX_FREQUENCY', 'BF_VTX_LOW_POWER_DISARM',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── Beeper params ──
  describe('Beeper params', () => {
    const params = [
      'BF_BEEPER_DISABLED_MASK', 'BF_BEEPER_DSHOT_TONE', 'BF_BEEPER_DSHOT_CONDITIONS_MASK',
    ];
    for (const name of params) {
      it(`${name} exists`, () => {
        expect(VIRTUAL_PARAMS.has(name)).toBe(true);
      });
    }
  });

  // ── All params have valid readCmd and writeCmd ──
  describe('all params have valid readCmd and writeCmd', () => {
    it('readCmd > 0 for all params', () => {
      for (const [name, def] of VIRTUAL_PARAMS) {
        expect(def.readCmd, `${name} readCmd should be > 0`).toBeGreaterThan(0);
      }
    });

    it('writeCmd > 0 for all params', () => {
      for (const [name, def] of VIRTUAL_PARAMS) {
        expect(def.writeCmd, `${name} writeCmd should be > 0`).toBeGreaterThan(0);
      }
    });

    it('all params have decode and encode functions', () => {
      for (const [name, def] of VIRTUAL_PARAMS) {
        expect(typeof def.decode, `${name} decode`).toBe('function');
        expect(typeof def.encode, `${name} encode`).toBe('function');
      }
    });
  });

  // ── U8 round-trip ──
  describe('U8 param decode/encode round-trip', () => {
    it('BF_PID_ROLL_P round-trips', () => {
      const def = VIRTUAL_PARAMS.get('BF_PID_ROLL_P')!;
      const payload = new Uint8Array(30);
      payload[0] = 45; // P at offset 0
      expect(def.decode(payload)).toBe(45);

      const encoded = def.encode(45, new Uint8Array(30));
      expect(encoded[0]).toBe(45);
      expect(def.decode(encoded)).toBe(45);
    });
  });

  // ── U16 round-trip ──
  describe('U16 param decode/encode round-trip', () => {
    it('BF_MOTOR_MIN_THROTTLE round-trips', () => {
      const def = VIRTUAL_PARAMS.get('BF_MOTOR_MIN_THROTTLE')!;
      const payload = new Uint8Array(10);
      // Write 1070 as little-endian U16 at offset 0
      payload[0] = 1070 & 0xff;
      payload[1] = (1070 >> 8) & 0xff;
      expect(def.decode(payload)).toBe(1070);

      const encoded = def.encode(1070, new Uint8Array(10));
      expect(def.decode(encoded)).toBe(1070);
    });
  });

  // ── U32 round-trip ──
  describe('U32 param decode/encode round-trip', () => {
    it('BF_FEATURE_MASK round-trips', () => {
      const def = VIRTUAL_PARAMS.get('BF_FEATURE_MASK')!;
      const val = 0x0000ABCD;
      const encoded = def.encode(val, new Uint8Array(4));
      expect(def.decode(encoded)).toBe(val);
    });
  });

  // ── Battery config custom encode ──
  describe('battery config custom encode', () => {
    it('BF_BATT_MIN_CELL writes both legacy U8 and U16', () => {
      const def = VIRTUAL_PARAMS.get('BF_BATT_MIN_CELL')!;
      const payload = new Uint8Array(13);
      const result = def.encode(330, payload); // 330 = 3.3V * 100
      // Legacy at offset 0: Math.round(330/10) = 33
      expect(result[0]).toBe(33);
      // U16 at offset 7: 330 LE
      expect(result[7]).toBe(330 & 0xff);
      expect(result[8]).toBe((330 >> 8) & 0xff);
    });
  });

  // ── VTX band custom encode ──
  describe('VTX band custom encode', () => {
    it('BF_VTX_BAND writes to offset 7', () => {
      const def = VIRTUAL_PARAMS.get('BF_VTX_BAND')!;
      const payload = new Uint8Array(14);
      const result = def.encode(4, payload);
      expect(result[7]).toBe(4);
      // Should not write to offset 1
      expect(result[1]).toBe(0);
    });
  });

  // ── VTX frequency custom encode ──
  describe('VTX frequency custom encode', () => {
    it('BF_VTX_FREQUENCY writes both offset 0 and 9', () => {
      const def = VIRTUAL_PARAMS.get('BF_VTX_FREQUENCY')!;
      const payload = new Uint8Array(14);
      const result = def.encode(5800, payload);
      // Check offset 0 (LE)
      expect(result[0]).toBe(5800 & 0xff);
      expect(result[1]).toBe((5800 >> 8) & 0xff);
      // Check offset 9 (LE)
      expect(result[9]).toBe(5800 & 0xff);
      expect(result[10]).toBe((5800 >> 8) & 0xff);
    });
  });

  // ── Boundary values ──
  describe('boundary values', () => {
    it('U8 boundaries: 0 and 255', () => {
      const def = VIRTUAL_PARAMS.get('BF_PID_ROLL_P')!;
      const p0 = def.encode(0, new Uint8Array(30));
      expect(def.decode(p0)).toBe(0);
      const p255 = def.encode(255, new Uint8Array(30));
      expect(def.decode(p255)).toBe(255);
    });

    it('U16 boundaries: 0 and 65535', () => {
      const def = VIRTUAL_PARAMS.get('BF_MOTOR_MIN_THROTTLE')!;
      const p0 = def.encode(0, new Uint8Array(10));
      expect(def.decode(p0)).toBe(0);
      const pMax = def.encode(65535, new Uint8Array(10));
      expect(def.decode(pMax)).toBe(65535);
    });
  });

  // ── getParamsByReadCmd ──
  describe('getParamsByReadCmd', () => {
    it('groups params by read command', () => {
      const groups = getParamsByReadCmd();
      expect(groups.size).toBeGreaterThan(0);

      // PID command 112 should have 30 params
      const pidParams = groups.get(112);
      expect(pidParams).toBeDefined();
      expect(pidParams!.length).toBe(30);

      // RC Tuning command 111 should have 17 params
      const rcParams = groups.get(111);
      expect(rcParams).toBeDefined();
      expect(rcParams!.length).toBe(17);
    });
  });

  // ── getReadCmdsForParams ──
  describe('getReadCmdsForParams', () => {
    it('returns unique commands for param names', () => {
      const cmds = getReadCmdsForParams(['BF_PID_ROLL_P', 'BF_PID_PITCH_I', 'BF_RC_RATE']);
      // PID uses 112, RC_RATE uses 111
      expect(cmds).toContain(112);
      expect(cmds).toContain(111);
      expect(cmds.length).toBe(2);
    });

    it('returns empty for unknown params', () => {
      const cmds = getReadCmdsForParams(['NONEXISTENT_PARAM']);
      expect(cmds).toEqual([]);
    });

    it('deduplicates same-command params', () => {
      const cmds = getReadCmdsForParams(['BF_PID_ROLL_P', 'BF_PID_ROLL_I', 'BF_PID_ROLL_D']);
      expect(cmds.length).toBe(1);
      expect(cmds[0]).toBe(112);
    });
  });

  // ── Encoding at one offset doesn't clobber adjacent bytes ──
  describe('encoding does not clobber adjacent bytes', () => {
    it('U8 encode only changes target byte', () => {
      const def = VIRTUAL_PARAMS.get('BF_PID_ROLL_P')!;
      const payload = new Uint8Array(30).fill(0xAA);
      const result = def.encode(42, payload);
      expect(result[0]).toBe(42);
      expect(result[1]).toBe(0xAA); // adjacent byte untouched
      expect(result[2]).toBe(0xAA);
    });

    it('U16 encode only changes 2 target bytes', () => {
      const def = VIRTUAL_PARAMS.get('BF_MOTOR_MIN_THROTTLE')!;
      const payload = new Uint8Array(10).fill(0xBB);
      const result = def.encode(1070, payload);
      expect(result[0]).toBe(1070 & 0xff);
      expect(result[1]).toBe((1070 >> 8) & 0xff);
      expect(result[2]).toBe(0xBB); // next byte untouched
    });
  });
});
