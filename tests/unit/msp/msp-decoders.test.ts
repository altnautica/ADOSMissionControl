import { describe, it, expect } from 'vitest';
import {
  decodeMspApiVersion,
  decodeMspFcVariant,
  decodeMspFcVersion,
  decodeMspBoardInfo,
  decodeMspStatusEx,
  decodeMspAttitude,
  decodeMspAnalog,
  decodeMspRc,
  decodeMspMotor,
  decodeMspRawImu,
  decodeMspAltitude,
  decodeMspBoxNames,
  decodeMspBoxIds,
  decodeMspModeRanges,
  decodeMspPid,
  decodeMspRcTuning,
  decodeMspMotorConfig,
  decodeMspBatteryConfig,
  decodeMspFailsafeConfig,
  decodeMspBlackboxConfig,
  decodeMspBeeperConfig,
  decodeMspVtxConfig,
  decodeMspGpsConfig,
  decodeMspRawGps,
  decodeMspBatteryState,
  decodeMspDataflashSummary,
  decodeMspOsdConfig,
} from '@/lib/protocol/msp/msp-decoders';
import {
  buildMspApiVersionPayload,
  buildMspFcVariantPayload,
  buildMspFcVersionPayload,
  buildMspBoardInfoPayload,
  buildMspStatusExPayload,
  buildMspAttitudePayload,
  buildMspAnalogPayload,
  buildMspRawImuPayload,
  buildMspAltitudePayload,
  buildMspRcPayload,
  buildMspMotorPayload,
  buildMspPidPayload,
  buildMspMotorConfigPayload,
  buildMspBatteryConfigPayload,
  buildMspFailsafeConfigPayload,
  buildMspVtxConfigPayload,
  buildMspGpsConfigPayload,
  buildMspBlackboxConfigPayload,
  buildMspBeeperConfigPayload,
  buildMspRawGpsPayload,
  buildMspBatteryStatePayload,
} from '../../helpers/msp-frame-builder';

/** Convert a Uint8Array to a DataView for the decoders */
function toDataView(payload: Uint8Array): DataView {
  return new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
}

describe('MSP Decoders', () => {
  // ── decodeMspApiVersion ──
  describe('decodeMspApiVersion', () => {
    it('decodes protocol, major, minor', () => {
      const payload = buildMspApiVersionPayload({ protocol: 0, major: 1, minor: 46 });
      const result = decodeMspApiVersion(toDataView(payload));
      expect(result.mspProtocolVersion).toBe(0);
      expect(result.apiVersionMajor).toBe(1);
      expect(result.apiVersionMinor).toBe(46);
    });

    it('decodes custom values', () => {
      const payload = buildMspApiVersionPayload({ protocol: 2, major: 3, minor: 10 });
      const result = decodeMspApiVersion(toDataView(payload));
      expect(result.mspProtocolVersion).toBe(2);
      expect(result.apiVersionMajor).toBe(3);
      expect(result.apiVersionMinor).toBe(10);
    });
  });

  // ── decodeMspFcVariant ──
  describe('decodeMspFcVariant', () => {
    it('decodes BTFL variant', () => {
      const payload = buildMspFcVariantPayload('BTFL');
      const result = decodeMspFcVariant(toDataView(payload));
      expect(result.variant).toBe('BTFL');
    });

    it('decodes INAV variant', () => {
      const payload = buildMspFcVariantPayload('INAV');
      const result = decodeMspFcVariant(toDataView(payload));
      expect(result.variant).toBe('INAV');
    });
  });

  // ── decodeMspFcVersion ──
  describe('decodeMspFcVersion', () => {
    it('decodes major.minor.patch', () => {
      const payload = buildMspFcVersionPayload({ major: 4, minor: 5, patch: 1 });
      const result = decodeMspFcVersion(toDataView(payload));
      expect(result.major).toBe(4);
      expect(result.minor).toBe(5);
      expect(result.patch).toBe(1);
    });
  });

  // ── decodeMspBoardInfo ──
  describe('decodeMspBoardInfo', () => {
    it('decodes board ID, hw revision, board type', () => {
      const payload = buildMspBoardInfoPayload({ boardId: 'S405', hwRevision: 2, boardType: 1 });
      const result = decodeMspBoardInfo(toDataView(payload));
      expect(result.boardId).toBe('S405');
      expect(result.hwRevision).toBe(2);
      expect(result.boardType).toBe(1);
    });
  });

  // ── decodeMspStatusEx ──
  describe('decodeMspStatusEx', () => {
    it('decodes with 0 flight mode flag bytes', () => {
      const payload = buildMspStatusExPayload({
        cycleTime: 125,
        i2cErrors: 3,
        sensors: 0x3f,
        modeFlags: 0x10,
        cpuLoad: 50,
        armDisableFlags: 0x0100,
        configStateFlags: 2,
      });
      const result = decodeMspStatusEx(toDataView(payload));
      expect(result.cycleTime).toBe(125);
      expect(result.i2cErrors).toBe(3);
      expect(result.sensors).toBe(0x3f);
      expect(result.modeFlags).toBe(0x10);
      expect(result.cpuLoad).toBe(50);
      expect(result.armDisableFlags).toBe(0x0100);
      expect(result.configStateFlags).toBe(2);
    });

    it('decodes with byteCount > 0', () => {
      // Build a custom payload with 2 flight mode flag bytes
      const byteCount = 2;
      const size = 16 + byteCount + 6;
      const payload = new Uint8Array(size);
      const dv = new DataView(payload.buffer);
      dv.setUint16(0, 250, true); // cycleTime
      dv.setUint16(2, 0, true);
      dv.setUint16(4, 0x1f, true);
      dv.setUint32(6, 0, true);
      dv.setUint8(10, 1); // currentProfile
      dv.setUint16(11, 60, true); // cpuLoad
      dv.setUint8(13, 3);
      dv.setUint8(14, 1); // rateProfile
      dv.setUint8(15, byteCount);
      // 2 bytes of flight mode flags (skip)
      payload[16] = 0xff;
      payload[17] = 0xff;
      const afterFlags = 16 + byteCount; // = 18
      dv.setUint8(afterFlags, 2); // armDisableCount
      dv.setUint32(afterFlags + 1, 0x00ff, true);
      dv.setUint8(afterFlags + 5, 1);

      const result = decodeMspStatusEx(toDataView(payload));
      expect(result.cycleTime).toBe(250);
      expect(result.currentProfile).toBe(1);
      expect(result.rateProfile).toBe(1);
      expect(result.armDisableFlags).toBe(0x00ff);
      expect(result.configStateFlags).toBe(1);
    });
  });

  // ── decodeMspAttitude ──
  describe('decodeMspAttitude', () => {
    it('decodes positive roll/pitch and yaw', () => {
      const payload = buildMspAttitudePayload({ roll: 15.5, pitch: 3.2, yaw: 180 });
      const result = decodeMspAttitude(toDataView(payload));
      expect(result.roll).toBeCloseTo(15.5, 1);
      expect(result.pitch).toBeCloseTo(3.2, 1);
      expect(result.yaw).toBe(180);
    });

    it('decodes negative roll/pitch', () => {
      const payload = buildMspAttitudePayload({ roll: -20.3, pitch: -5.1, yaw: -90 });
      const result = decodeMspAttitude(toDataView(payload));
      expect(result.roll).toBeCloseTo(-20.3, 1);
      expect(result.pitch).toBeCloseTo(-5.1, 1);
      expect(result.yaw).toBe(-90);
    });
  });

  // ── decodeMspAnalog ──
  describe('decodeMspAnalog', () => {
    it('uses U16 voltage override at offset 7', () => {
      const payload = buildMspAnalogPayload({ voltage: 12.34, mAhDrawn: 500, rssi: 800, amperage: 5.5 });
      const result = decodeMspAnalog(toDataView(payload));
      expect(result.voltage).toBeCloseTo(12.34, 2);
      expect(result.mAhDrawn).toBe(500);
      expect(result.rssi).toBe(800);
      expect(result.amperage).toBeCloseTo(5.5, 2);
    });
  });

  // ── decodeMspRc ──
  describe('decodeMspRc', () => {
    it('decodes 8 channels', () => {
      const channels = [1500, 1500, 1000, 1500, 1000, 1000, 1000, 1000];
      const payload = buildMspRcPayload(channels);
      const result = decodeMspRc(toDataView(payload));
      expect(result.channels).toEqual(channels);
      expect(result.channels.length).toBe(8);
    });

    it('decodes 16 channels', () => {
      const channels = Array.from({ length: 16 }, (_, i) => 1000 + i * 62);
      const payload = buildMspRcPayload(channels);
      const result = decodeMspRc(toDataView(payload));
      expect(result.channels).toEqual(channels);
      expect(result.channels.length).toBe(16);
    });
  });

  // ── decodeMspMotor ──
  describe('decodeMspMotor', () => {
    it('decodes 4 motors', () => {
      const motors = [1100, 1200, 1300, 1400];
      const payload = buildMspMotorPayload(motors);
      const result = decodeMspMotor(toDataView(payload));
      expect(result.motors).toEqual(motors);
    });

    it('decodes 8 motors', () => {
      const motors = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700];
      const payload = buildMspMotorPayload(motors);
      const result = decodeMspMotor(toDataView(payload));
      expect(result.motors).toEqual(motors);
      expect(result.motors.length).toBe(8);
    });
  });

  // ── decodeMspRawImu ──
  describe('decodeMspRawImu', () => {
    it('decodes all 9 S16 fields including negatives', () => {
      const payload = buildMspRawImuPayload({
        accX: -100, accY: 200, accZ: 512,
        gyrX: -50, gyrY: 75, gyrZ: -10,
        magX: 300, magY: -400, magZ: 500,
      });
      const result = decodeMspRawImu(toDataView(payload));
      expect(result.accX).toBe(-100);
      expect(result.accY).toBe(200);
      expect(result.accZ).toBe(512);
      expect(result.gyrX).toBe(-50);
      expect(result.gyrY).toBe(75);
      expect(result.gyrZ).toBe(-10);
      expect(result.magX).toBe(300);
      expect(result.magY).toBe(-400);
      expect(result.magZ).toBe(500);
    });
  });

  // ── decodeMspAltitude ──
  describe('decodeMspAltitude', () => {
    it('decodes with vario present', () => {
      const payload = buildMspAltitudePayload({ altitude: 50.25, vario: 10 });
      const result = decodeMspAltitude(toDataView(payload));
      expect(result.altitude).toBeCloseTo(50.25, 2);
      expect(result.vario).toBe(10);
    });

    it('defaults vario to 0 for short payload', () => {
      // Build a 4-byte payload (no vario)
      const payload = new Uint8Array(4);
      const dv = new DataView(payload.buffer);
      dv.setInt32(0, 1000, true); // altitude in cm
      const result = decodeMspAltitude(toDataView(payload));
      expect(result.altitude).toBeCloseTo(10.0, 2);
      expect(result.vario).toBe(0);
    });
  });

  // ── decodeMspBoxNames ──
  describe('decodeMspBoxNames', () => {
    it('parses semicolon-delimited names', () => {
      const str = 'ARM;ANGLE;HORIZON;BARO;';
      const payload = new Uint8Array(str.length);
      for (let i = 0; i < str.length; i++) payload[i] = str.charCodeAt(i);
      const result = decodeMspBoxNames(toDataView(payload));
      expect(result.names).toEqual(['ARM', 'ANGLE', 'HORIZON', 'BARO']);
    });

    it('handles empty payload', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspBoxNames(toDataView(payload));
      expect(result.names).toEqual([]);
    });
  });

  // ── decodeMspBoxIds ──
  describe('decodeMspBoxIds', () => {
    it('returns one ID per byte', () => {
      const payload = new Uint8Array([0, 1, 2, 3, 27]);
      const result = decodeMspBoxIds(toDataView(payload));
      expect(result.ids).toEqual([0, 1, 2, 3, 27]);
    });
  });

  // ── decodeMspModeRanges ──
  describe('decodeMspModeRanges', () => {
    it('applies step-to-PWM conversion (x25 + 900)', () => {
      // boxId=0, auxChannel=0, startStep=4 (1000), endStep=28 (1600)
      const payload = new Uint8Array([0, 0, 4, 28]);
      const result = decodeMspModeRanges(toDataView(payload));
      expect(result.length).toBe(1);
      expect(result[0].boxId).toBe(0);
      expect(result[0].auxChannel).toBe(0);
      expect(result[0].rangeStart).toBe(900 + 4 * 25); // 1000
      expect(result[0].rangeEnd).toBe(900 + 28 * 25); // 1600
    });
  });

  // ── decodeMspPid ──
  describe('decodeMspPid', () => {
    it('decodes 10 axes with 3 bytes each', () => {
      const pids = Array.from({ length: 10 }, (_, i) => ({
        p: 40 + i, i: 30 + i, d: 20 + i,
      }));
      const payload = buildMspPidPayload(pids);
      const result = decodeMspPid(toDataView(payload));
      expect(result.pids.length).toBe(10);
      expect(result.pids[0]).toEqual({ p: 40, i: 30, d: 20 });
      expect(result.pids[9]).toEqual({ p: 49, i: 39, d: 29 });
    });
  });

  // ── decodeMspRcTuning ──
  describe('decodeMspRcTuning', () => {
    it('decodes all 23 bytes with /100 divisions', () => {
      const payload = new Uint8Array(23);
      const dv = new DataView(payload.buffer);
      dv.setUint8(0, 150); // rcRate -> 1.5
      dv.setUint8(1, 50);  // rcExpo -> 0.5
      dv.setUint8(2, 70);  // rollRate -> 0.7
      dv.setUint8(3, 70);  // pitchRate
      dv.setUint8(4, 60);  // yawRate
      dv.setUint8(5, 0);   // deprecated
      dv.setUint8(6, 50);  // throttleMid
      dv.setUint8(7, 0);   // throttleExpo
      dv.setUint16(8, 0, true); // deprecated
      dv.setUint8(10, 25); // rcYawExpo
      dv.setUint8(11, 100); // rcYawRate
      dv.setUint8(12, 70); // rcPitchRate
      dv.setUint8(13, 50); // rcPitchExpo
      dv.setUint8(14, 1);  // throttleLimitType
      dv.setUint8(15, 100); // throttleLimitPercent
      dv.setUint16(16, 1998, true); // rollRateLimit
      dv.setUint16(18, 1998, true); // pitchRateLimit
      dv.setUint16(20, 1998, true); // yawRateLimit
      dv.setUint8(22, 3);  // ratesType

      const result = decodeMspRcTuning(toDataView(payload));
      expect(result.rcRate).toBeCloseTo(1.5, 2);
      expect(result.rcExpo).toBeCloseTo(0.5, 2);
      expect(result.rollRate).toBeCloseTo(0.7, 2);
      expect(result.throttleMid).toBeCloseTo(0.5, 2);
      expect(result.rcYawExpo).toBeCloseTo(0.25, 2);
      expect(result.rcYawRate).toBeCloseTo(1.0, 2);
      expect(result.throttleLimitType).toBe(1);
      expect(result.throttleLimitPercent).toBe(100);
      expect(result.rollRateLimit).toBe(1998);
      expect(result.pitchRateLimit).toBe(1998);
      expect(result.yawRateLimit).toBe(1998);
      expect(result.ratesType).toBe(3);
    });
  });

  // ── decodeMspMotorConfig ──
  describe('decodeMspMotorConfig', () => {
    it('decodes motor config with boolean fields', () => {
      const payload = buildMspMotorConfigPayload({
        minThrottle: 1070,
        maxThrottle: 2000,
        minCommand: 1000,
        motorCount: 4,
        motorPoles: 14,
        useDshotTelemetry: true,
        useEscSensor: false,
      });
      const result = decodeMspMotorConfig(toDataView(payload));
      expect(result.minThrottle).toBe(1070);
      expect(result.maxThrottle).toBe(2000);
      expect(result.minCommand).toBe(1000);
      expect(result.motorCount).toBe(4);
      expect(result.motorPoles).toBe(14);
      expect(result.useDshotTelemetry).toBe(true);
      expect(result.useEscSensor).toBe(false);
    });
  });

  // ── decodeMspBatteryConfig ──
  describe('decodeMspBatteryConfig', () => {
    it('uses U16/100 override for voltages', () => {
      const payload = buildMspBatteryConfigPayload({
        minCell: 3.3, maxCell: 4.35, warningCell: 3.5, capacity: 1300,
        voltSource: 1, currSource: 2,
      });
      const result = decodeMspBatteryConfig(toDataView(payload));
      expect(result.vbatMinCellVoltage).toBeCloseTo(3.3, 2);
      expect(result.vbatMaxCellVoltage).toBeCloseTo(4.35, 2);
      expect(result.vbatWarningCellVoltage).toBeCloseTo(3.5, 2);
      expect(result.capacity).toBe(1300);
      expect(result.voltageMeterSource).toBe(1);
      expect(result.currentMeterSource).toBe(2);
    });
  });

  // ── decodeMspFailsafeConfig ──
  describe('decodeMspFailsafeConfig', () => {
    it('decodes all failsafe fields', () => {
      const payload = buildMspFailsafeConfigPayload({
        delay: 10, offDelay: 20, throttle: 1050, switchMode: 1, throttleLowDelay: 200, procedure: 2,
      });
      const result = decodeMspFailsafeConfig(toDataView(payload));
      expect(result.delay).toBe(10);
      expect(result.offDelay).toBe(20);
      expect(result.throttle).toBe(1050);
      expect(result.switchMode).toBe(1);
      expect(result.throttleLowDelay).toBe(200);
      expect(result.procedure).toBe(2);
    });
  });

  // ── decodeMspBlackboxConfig ──
  describe('decodeMspBlackboxConfig', () => {
    it('decodes bit 0 for supported flag', () => {
      const payload = buildMspBlackboxConfigPayload({ supported: true, device: 2, rateNum: 1, rateDenom: 4, pDenom: 32, sampleRate: 1 });
      const result = decodeMspBlackboxConfig(toDataView(payload));
      expect(result.supported).toBe(true);
      expect(result.device).toBe(2);
      expect(result.rateNum).toBe(1);
      expect(result.rateDenom).toBe(4);
      expect(result.pDenom).toBe(32);
      expect(result.sampleRate).toBe(1);
    });

    it('supported=false when bit 0 is 0', () => {
      const payload = buildMspBlackboxConfigPayload({ supported: false });
      const result = decodeMspBlackboxConfig(toDataView(payload));
      expect(result.supported).toBe(false);
    });
  });

  // ── decodeMspBeeperConfig ──
  describe('decodeMspBeeperConfig', () => {
    it('decodes masks and tone', () => {
      const payload = buildMspBeeperConfigPayload({
        disabledMask: 0x0f00, dshotBeaconTone: 3, dshotBeaconConditionsMask: 0xff,
      });
      const result = decodeMspBeeperConfig(toDataView(payload));
      expect(result.disabledMask).toBe(0x0f00);
      expect(result.dshotBeaconTone).toBe(3);
      expect(result.dshotBeaconConditionsMask).toBe(0xff);
    });
  });

  // ── decodeMspVtxConfig ──
  describe('decodeMspVtxConfig', () => {
    it('decodes with boolean conversions', () => {
      const payload = buildMspVtxConfigPayload({
        type: 1, band: 4, channel: 5, power: 3,
        pitMode: true, frequency: 5800, deviceReady: true,
        lowPowerDisarm: 1, pitModeFrequency: 5600,
        vtxTableAvailable: true, vtxTableBands: 5, vtxTableChannels: 8, vtxTablePowerLevels: 5,
      });
      const result = decodeMspVtxConfig(toDataView(payload));
      expect(result.type).toBe(1);
      expect(result.band).toBe(4);
      expect(result.channel).toBe(5);
      expect(result.power).toBe(3);
      expect(result.pitMode).toBe(true);
      expect(result.frequency).toBe(5800);
      expect(result.deviceReady).toBe(true);
      expect(result.lowPowerDisarm).toBe(1);
      expect(result.pitModeFrequency).toBe(5600);
      expect(result.vtxTableAvailable).toBe(true);
      expect(result.vtxTableBands).toBe(5);
      expect(result.vtxTableChannels).toBe(8);
      expect(result.vtxTablePowerLevels).toBe(5);
    });

    it('pitMode false when byte is 0', () => {
      const payload = buildMspVtxConfigPayload({ pitMode: false, deviceReady: false, vtxTableAvailable: false });
      const result = decodeMspVtxConfig(toDataView(payload));
      expect(result.pitMode).toBe(false);
      expect(result.deviceReady).toBe(false);
      expect(result.vtxTableAvailable).toBe(false);
    });
  });

  // ── decodeMspGpsConfig ──
  describe('decodeMspGpsConfig', () => {
    it('decodes all GPS config fields', () => {
      const payload = buildMspGpsConfigPayload({
        provider: 1, sbasMode: 2, autoConfig: 1, autoBaud: 0, homePointOnce: 1, ubloxUseGalileo: 1,
      });
      const result = decodeMspGpsConfig(toDataView(payload));
      expect(result.provider).toBe(1);
      expect(result.sbasMode).toBe(2);
      expect(result.autoConfig).toBe(1);
      expect(result.autoBaud).toBe(0);
      expect(result.homePointOnce).toBe(1);
      expect(result.ubloxUseGalileo).toBe(1);
    });
  });

  // ── decodeMspRawGps ──
  describe('decodeMspRawGps', () => {
    it('decodes lat/lon with /1e7 and groundCourse with /10', () => {
      const payload = buildMspRawGpsPayload({
        fixType: 3, numSat: 12, lat: 12.9716, lon: 77.5946,
        alt: 150, speed: 300, groundCourse: 45.5,
      });
      const result = decodeMspRawGps(toDataView(payload));
      expect(result.fixType).toBe(3);
      expect(result.numSat).toBe(12);
      expect(result.lat).toBeCloseTo(12.9716, 4);
      expect(result.lon).toBeCloseTo(77.5946, 4);
      expect(result.alt).toBe(150);
      expect(result.speed).toBe(300);
      expect(result.groundCourse).toBeCloseTo(45.5, 1);
    });
  });

  // ── decodeMspBatteryState ──
  describe('decodeMspBatteryState', () => {
    it('uses U16 override at offset 9 for voltage', () => {
      const payload = buildMspBatteryStatePayload({
        cellCount: 4, capacity: 2200, voltage: 16.8,
        mAhDrawn: 500, amperage: 12.5, state: 1,
      });
      const result = decodeMspBatteryState(toDataView(payload));
      expect(result.cellCount).toBe(4);
      expect(result.capacity).toBe(2200);
      expect(result.voltage).toBeCloseTo(16.8, 2);
      expect(result.mAhDrawn).toBe(500);
      expect(result.amperage).toBeCloseTo(12.5, 2);
      expect(result.state).toBe(1);
    });
  });

  // ── decodeMspDataflashSummary ──
  describe('decodeMspDataflashSummary', () => {
    it('returns defaults for short payload', () => {
      const payload = new Uint8Array(4); // less than 13
      const result = decodeMspDataflashSummary(toDataView(payload));
      expect(result.ready).toBe(false);
      expect(result.supported).toBe(false);
      expect(result.sectors).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.usedSize).toBe(0);
    });

    it('decodes full payload', () => {
      const payload = new Uint8Array(13);
      const dv = new DataView(payload.buffer);
      dv.setUint8(0, 3); // bit 0=ready, bit 1=supported
      dv.setUint32(1, 256, true);
      dv.setUint32(5, 8388608, true); // 8MB
      dv.setUint32(9, 1048576, true); // 1MB used
      const result = decodeMspDataflashSummary(toDataView(payload));
      expect(result.ready).toBe(true);
      expect(result.supported).toBe(true);
      expect(result.sectors).toBe(256);
      expect(result.totalSize).toBe(8388608);
      expect(result.usedSize).toBe(1048576);
    });
  });

  // ── decodeMspOsdConfig ──
  describe('decodeMspOsdConfig', () => {
    it('returns defaults for empty payload', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspOsdConfig(toDataView(payload));
      expect(result.flags).toBe(0);
      expect(result.videoSystem).toBe(0);
      expect(result.items).toEqual([]);
    });

    it('decodes OSD items from remaining bytes', () => {
      const payload = new Uint8Array(10); // 6 header + 2 items (2 bytes each)
      const dv = new DataView(payload.buffer);
      dv.setUint8(0, 1); // flags
      dv.setUint8(1, 2); // videoSystem
      dv.setUint8(2, 0); // units
      dv.setUint8(3, 50); // rssiAlarm
      dv.setUint16(4, 1500, true); // capacityWarning
      dv.setUint16(6, 0x0801, true); // item 0
      dv.setUint16(8, 0x0402, true); // item 1
      const result = decodeMspOsdConfig(toDataView(payload));
      expect(result.flags).toBe(1);
      expect(result.videoSystem).toBe(2);
      expect(result.rssiAlarm).toBe(50);
      expect(result.capacityWarning).toBe(1500);
      expect(result.items.length).toBe(2);
      expect(result.items[0].position).toBe(0x0801);
      expect(result.items[1].position).toBe(0x0402);
    });
  });

  // ── Boundary: empty payloads ──
  describe('boundary cases', () => {
    it('decodeMspRc with empty payload returns 0 channels', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspRc(toDataView(payload));
      expect(result.channels).toEqual([]);
    });

    it('decodeMspMotor with empty payload returns 0 motors', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspMotor(toDataView(payload));
      expect(result.motors).toEqual([]);
    });

    it('decodeMspBoxIds with empty payload returns empty', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspBoxIds(toDataView(payload));
      expect(result.ids).toEqual([]);
    });

    it('decodeMspModeRanges with empty payload returns empty', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspModeRanges(toDataView(payload));
      expect(result).toEqual([]);
    });

    it('decodeMspPid with empty payload returns empty', () => {
      const payload = new Uint8Array(0);
      const result = decodeMspPid(toDataView(payload));
      expect(result.pids).toEqual([]);
    });
  });
});
