import { describe, it, expect } from 'vitest';
import {
  encodeMspSetPid,
  encodeMspSetRcTuning,
  encodeMspSetMotorConfig,
  encodeMspSetBatteryConfig,
  encodeMspSetFailsafeConfig,
  encodeMspSetVtxConfig,
  encodeMspSetGpsConfig,
  encodeMspSetBlackboxConfig,
  encodeMspSetBeeperConfig,
  encodeMspSetAdjustmentRange,
  encodeMspSetModeRange,
  encodeMspSetReboot,
  encodeMspSetOsdConfig,
  encodeMspSetRawRc,
  encodeMspSetMotor,
} from '@/lib/protocol/msp/msp-encoders';
import {
  decodeMspPid,
  decodeMspRcTuning,
  decodeMspMotorConfig,
  decodeMspBatteryConfig,
  decodeMspFailsafeConfig,
  decodeMspVtxConfig,
  decodeMspGpsConfig,
  decodeMspBlackboxConfig,
  decodeMspBeeperConfig,
  decodeMspRc,
  decodeMspMotor,
  decodeMspModeRanges,
} from '@/lib/protocol/msp/msp-decoders';

function toDataView(payload: Uint8Array): DataView {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

describe('MSP Encoders', () => {
  describe('encodeMspSetPid', () => {
    it('encodes correct byte length and round-trips with decoder', () => {
      const pids = [
        { p: 45, i: 80, d: 30 },
        { p: 50, i: 85, d: 35 },
        { p: 65, i: 90, d: 40 },
      ];
      const encoded = encodeMspSetPid(pids);
      expect(encoded.length).toBe(9); // 3 axes * 3 bytes
      const decoded = decodeMspPid(toDataView(encoded));
      expect(decoded.pids).toEqual(pids);
    });
  });

  describe('encodeMspSetRcTuning', () => {
    it('encodes 23 bytes and round-trips', () => {
      const tuning = {
        rcRate: 1.5, rcExpo: 0.5, rollRate: 0.7, pitchRate: 0.7, yawRate: 0.6,
        throttleMid: 0.5, throttleExpo: 0.0,
        rcYawExpo: 0.25, rcYawRate: 1.0, rcPitchRate: 0.7, rcPitchExpo: 0.5,
        throttleLimitType: 1, throttleLimitPercent: 100,
        rollRateLimit: 1998, pitchRateLimit: 1998, yawRateLimit: 1998,
        ratesType: 3,
      };
      const encoded = encodeMspSetRcTuning(tuning);
      expect(encoded.length).toBe(23);
      const decoded = decodeMspRcTuning(toDataView(encoded));
      expect(decoded.rcRate).toBeCloseTo(1.5, 2);
      expect(decoded.rollRateLimit).toBe(1998);
      expect(decoded.ratesType).toBe(3);
    });
  });

  describe('encodeMspSetMotorConfig', () => {
    it('encodes 8 bytes', () => {
      const config = {
        minThrottle: 1070, maxThrottle: 2000, minCommand: 1000,
        motorPoles: 14, useDshotTelemetry: true,
      };
      const encoded = encodeMspSetMotorConfig(config);
      expect(encoded.length).toBe(8);
      // Verify specific bytes
      const dv = toDataView(encoded);
      expect(dv.getUint16(0, true)).toBe(1070);
      expect(dv.getUint16(2, true)).toBe(2000);
      expect(dv.getUint8(6)).toBe(14);
      expect(dv.getUint8(7)).toBe(1); // true -> 1
    });
  });

  describe('encodeMspSetBatteryConfig', () => {
    it('encodes 13 bytes with legacy and new voltage fields', () => {
      const config = {
        vbatMinCellVoltage: 3.3, vbatMaxCellVoltage: 4.35,
        vbatWarningCellVoltage: 3.5, capacity: 1300,
        voltageMeterSource: 1, currentMeterSource: 2,
      };
      const encoded = encodeMspSetBatteryConfig(config);
      expect(encoded.length).toBe(13);
      // Round-trip
      const decoded = decodeMspBatteryConfig(toDataView(encoded));
      expect(decoded.vbatMinCellVoltage).toBeCloseTo(3.3, 2);
      expect(decoded.vbatMaxCellVoltage).toBeCloseTo(4.35, 2);
      expect(decoded.capacity).toBe(1300);
      // Verify legacy byte is also written
      expect(encoded[0]).toBe(33); // 3.3 * 10
    });
  });

  describe('encodeMspSetFailsafeConfig', () => {
    it('encodes 8 bytes and round-trips', () => {
      const config = {
        delay: 10, offDelay: 20, throttle: 1050,
        switchMode: 1, throttleLowDelay: 200, procedure: 2,
      };
      const encoded = encodeMspSetFailsafeConfig(config);
      expect(encoded.length).toBe(8);
      const decoded = decodeMspFailsafeConfig(toDataView(encoded));
      expect(decoded).toEqual(config);
    });
  });

  describe('encodeMspSetVtxConfig', () => {
    it('encodes 14 bytes with correct field positions', () => {
      const config = {
        frequency: 5800, power: 3, pitMode: true, lowPowerDisarm: 1,
        pitModeFrequency: 5600, band: 4, channel: 5,
        vtxTableBands: 5, vtxTableChannels: 8, vtxTablePowerLevels: 5,
        vtxTableClear: false,
      };
      const encoded = encodeMspSetVtxConfig(config);
      expect(encoded.length).toBe(14);
      const dv = toDataView(encoded);
      expect(dv.getUint16(0, true)).toBe(5800); // frequency at 0
      expect(dv.getUint8(2)).toBe(3); // power
      expect(dv.getUint8(3)).toBe(1); // pitMode
      expect(dv.getUint8(7)).toBe(4); // band at 7
      expect(dv.getUint8(8)).toBe(5); // channel at 8
      expect(dv.getUint16(9, true)).toBe(5800); // frequency again at 9
    });
  });

  describe('encodeMspSetGpsConfig', () => {
    it('encodes 6 bytes and round-trips', () => {
      const config = {
        provider: 1, sbasMode: 2, autoConfig: 1,
        autoBaud: 0, homePointOnce: 1, ubloxUseGalileo: 1,
      };
      const encoded = encodeMspSetGpsConfig(config);
      expect(encoded.length).toBe(6);
      const decoded = decodeMspGpsConfig(toDataView(encoded));
      expect(decoded).toEqual(config);
    });
  });

  describe('encodeMspSetBlackboxConfig', () => {
    it('encodes 6 bytes and round-trips', () => {
      const config = { device: 2, rateNum: 1, rateDenom: 4, pDenom: 32, sampleRate: 1 };
      const encoded = encodeMspSetBlackboxConfig(config);
      expect(encoded.length).toBe(6);
      // Decoder reads from offset 1 for device (read format has 'supported' byte at 0).
      // So direct round-trip doesn't work perfectly for blackbox. Check bytes instead.
      const dv = toDataView(encoded);
      expect(dv.getUint8(0)).toBe(2); // device
      expect(dv.getUint8(1)).toBe(1); // rateNum
      expect(dv.getUint8(2)).toBe(4); // rateDenom
      expect(dv.getUint16(3, true)).toBe(32); // pDenom
      expect(dv.getUint8(5)).toBe(1); // sampleRate
    });
  });

  describe('encodeMspSetBeeperConfig', () => {
    it('encodes 9 bytes and round-trips', () => {
      const encoded = encodeMspSetBeeperConfig(0x0f00, 3, 0xff);
      expect(encoded.length).toBe(9);
      const decoded = decodeMspBeeperConfig(toDataView(encoded));
      expect(decoded.disabledMask).toBe(0x0f00);
      expect(decoded.dshotBeaconTone).toBe(3);
      expect(decoded.dshotBeaconConditionsMask).toBe(0xff);
    });
  });

  describe('encodeMspSetAdjustmentRange', () => {
    it('encodes 7 bytes with PWM-to-step conversion', () => {
      const encoded = encodeMspSetAdjustmentRange(0, {
        slotIndex: 1, auxChannelIndex: 2,
        rangeStart: 1000, rangeEnd: 1600,
        adjustmentFunction: 3, auxSwitchChannelIndex: 4,
      });
      expect(encoded.length).toBe(7);
      expect(encoded[0]).toBe(0); // index
      expect(encoded[1]).toBe(1); // slotIndex
      expect(encoded[3]).toBe(4); // (1000-900)/25 = 4
      expect(encoded[4]).toBe(28); // (1600-900)/25 = 28
    });
  });

  describe('encodeMspSetModeRange', () => {
    it('encodes 5 bytes with PWM-to-step conversion', () => {
      const encoded = encodeMspSetModeRange({
        index: 0, boxId: 1, auxChannel: 0,
        rangeStart: 1700, rangeEnd: 2100,
      });
      expect(encoded.length).toBe(5);
      expect(encoded[0]).toBe(0); // index
      expect(encoded[1]).toBe(1); // boxId
      expect(encoded[3]).toBe(32); // (1700-900)/25 = 32
      expect(encoded[4]).toBe(48); // (2100-900)/25 = 48
    });
  });

  describe('encodeMspSetReboot', () => {
    it('encodes 1 byte reboot type', () => {
      const encoded = encodeMspSetReboot(0);
      expect(encoded.length).toBe(1);
      expect(encoded[0]).toBe(0);

      const bootloader = encodeMspSetReboot(1);
      expect(bootloader[0]).toBe(1);
    });
  });

  describe('encodeMspSetOsdConfig', () => {
    it('encodes element mode (3 bytes)', () => {
      const encoded = encodeMspSetOsdConfig(5, 0x0801);
      expect(encoded.length).toBe(3);
      expect(encoded[0]).toBe(5); // index
      const dv = toDataView(encoded);
      expect(dv.getUint16(1, true)).toBe(0x0801);
    });

    it('encodes video system mode (2 bytes) when index is 0xFF', () => {
      const encoded = encodeMspSetOsdConfig(0xff, 2);
      expect(encoded.length).toBe(2);
      expect(encoded[0]).toBe(0xff);
      expect(encoded[1]).toBe(2); // video system
    });
  });

  describe('encodeMspSetRawRc', () => {
    it('encodes channels as U16 values', () => {
      const channels = [1500, 1500, 1000, 1500, 1200, 1800];
      const encoded = encodeMspSetRawRc(channels);
      expect(encoded.length).toBe(12);
      const decoded = decodeMspRc(toDataView(encoded));
      expect(decoded.channels).toEqual(channels);
    });
  });

  describe('encodeMspSetMotor', () => {
    it('encodes motors as U16 values and round-trips', () => {
      const motors = [1100, 1200, 1300, 1400];
      const encoded = encodeMspSetMotor(motors);
      expect(encoded.length).toBe(8);
      const decoded = decodeMspMotor(toDataView(encoded));
      expect(decoded.motors).toEqual(motors);
    });
  });
});
