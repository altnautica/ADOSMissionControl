import { describe, it, expect } from 'vitest';
import {
  encodeMspSetPid,
  encodeMspSetRcTuning,
  encodeMspSetAdjustmentRange,
} from '@/lib/protocol/msp/encoders/tuning';
import {
  encodeMspSetFailsafeConfig,
  encodeMspSetBeeperConfig,
  encodeMspSetModeRange,
} from '@/lib/protocol/msp/encoders/config';
import {
  encodeMspSetVtxConfig,
  encodeMspSetOsdConfig,
  encodeMspSetOsdGeneralConfig,
} from '@/lib/protocol/msp/encoders/osd-led';
import {
  decodeMspPid,
  decodeMspRcTuning,
  decodeMspFailsafeConfig,
  decodeMspBeeperConfig,
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

  describe('encodeMspSetOsdConfig', () => {
    it('encodes element mode (3 bytes)', () => {
      const encoded = encodeMspSetOsdConfig(5, 0x0801);
      expect(encoded.length).toBe(3);
      expect(encoded[0]).toBe(5); // index
      const dv = toDataView(encoded);
      expect(dv.getUint16(1, true)).toBe(0x0801);
    });

    it('rejects the general-settings address; that block has its own encoder', () => {
      expect(() => encodeMspSetOsdConfig(0xff, 2)).toThrow(RangeError);
    });
  });

  describe('encodeMspSetOsdGeneralConfig', () => {
    // Reads the payload the way Betaflight's MSP_SET_OSD_CONFIG handler does
    // for address -1: fixed fields first, then optional fields only while
    // enough bytes remain.
    const bfReadGeneral = (p: Uint8Array) => {
      const dv = toDataView(p);
      let o = 0;
      const u8 = () => dv.getUint8(o++);
      const u16 = () => { const v = dv.getUint16(o, true); o += 2; return v; };
      const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
      const left = () => p.length - o;
      if (p.length < 10) throw new Error('short -1 block: firmware reads past the payload');
      const addr = u8();
      const out = { addr, video: u8(), units: u8(), rssi: u8(), cap: u16(), skip: u16(), alt: u16(), warnings: -1, profile: -1 };
      if (left() >= 2) out.warnings = u16();
      if (left() >= 4) out.warnings = u32();
      if (left() >= 1) out.profile = u8();
      return out;
    };

    it('carries every field the firmware reads and leaves the OSD profile alone', () => {
      const encoded = encodeMspSetOsdGeneralConfig({
        videoSystem: 3, units: 1, rssiAlarm: 25, capacityWarning: 2200, altAlarm: 100, enabledWarnings: 0x0007_8421,
      });
      expect(bfReadGeneral(encoded)).toEqual({
        addr: 0xff, video: 3, units: 1, rssi: 25, cap: 2200, skip: 0, alt: 100, warnings: 0x0007_8421, profile: -1,
      });
    });
  });
});
