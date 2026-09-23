/**
 * Parity snapshots for every iNav MSP decoder.
 *
 * Each test feeds a hand-crafted byte fixture through a decoder and captures
 * the decoded output via `toMatchSnapshot`. Post-refactor, snapshots must
 * match byte-for-byte — any drift is a regression.
 *
 * The companion file `inav-decoders.test.ts` has explicit assertions for
 * each decoder's behaviour. This file exists specifically to catch silent
 * shape/order/field-name drift during codebase reorganisation.
 */

import { describe, it, expect } from "vitest";
import {
  decodeMspWp,
  decodeMspINavStatus,
  decodeMspINavMisc,
  decodeMspINavMisc2,
  decodeMspINavSafehome,
  decodeMspINavNavConfigLegacy,
  decodeMspINavAnalog,
  decodeMspINavBatteryConfig,
  decodeMspINavRateProfile,
  decodeMspINavAirSpeed,
  decodeMspINavOsdLayoutsHeader,
  decodeMspINavOsdAlarms,
  decodeMspINavOsdPreferences,
  decodeMspINavMcBraking,
  decodeMspINavTimerOutputMode,
  decodeMspINavOutputMappingExt2,
  decodeMspINavTempSensorConfig,
  decodeMspINavTemperatures,
  decodeMspINavServoMixer,
  decodeMspINavLogicConditions,
  decodeMspINavLogicConditionsStatus,
  decodeMspINavGvarStatus,
  decodeMspINavProgrammingPid,
  decodeMspINavProgrammingPidStatus,
  decodeMspINavPid,
  decodeMspINavFwApproach,
  decodeMspINavRateDynamics,
  decodeMspINavEzTune,
  decodeMspAdsbVehicleList,
  decodeCommonSetting,
  decodeCommonSettingInfo,
  decodeCommonPgList,
} from "@/lib/protocol/msp/msp-decoders-inav";

// ── fixture helpers ────────────────────────────────────────────
function dv(bytes: number[]): DataView {
  return new DataView(new Uint8Array(bytes).buffer);
}

function u16(v: number): [number, number] {
  return [v & 0xff, (v >> 8) & 0xff];
}

function s16(v: number): [number, number] {
  const buf = new Uint8Array(2);
  new DataView(buf.buffer).setInt16(0, v, true);
  return [buf[0], buf[1]];
}

function u32(v: number): [number, number, number, number] {
  return [v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff];
}

function s32(v: number): [number, number, number, number] {
  const buf = new Uint8Array(4);
  new DataView(buf.buffer).setInt32(0, v, true);
  return [buf[0], buf[1], buf[2], buf[3]];
}

function normalise<T>(v: T): T {
  // Snapshot-stable JSON. Handles typed arrays (Uint8Array) by dumping to plain array.
  return JSON.parse(
    JSON.stringify(v, (_k, x) => {
      if (x instanceof Uint8Array) return Array.from(x);
      return x;
    }),
  ) as T;
}

// ── waypoint / safehome / nav ──────────────────────────────────
describe("iNav decoder parity", () => {
  it("decodeMspWp", () => {
    const bytes = [
      0x03, // number
      0x01, // action
      ...s32(127560000), // lat
      ...s32(779420000), // lon
      ...s32(5000), // alt
      ...s16(500), // p1
      ...s16(0), // p2
      ...s16(0), // p3
      0x00, // flags (not last)
    ];
    expect(normalise(decodeMspWp(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavStatus", () => {
    // MSP2_INAV_STATUS (0x2000) — the layout iNav's fc_msp.c actually writes:
    // cycleTime, i2cErrors, sensorStatus, averageSystemLoad, profiles byte,
    // armingFlags, then the box bitmask tail.
    const bytes = [
      ...u16(1234), // cycleTime
      ...u16(5), // i2cErrors
      ...u16(0x0007), // sensorStatus
      ...u16(42), // averageSystemLoadPercent
      0x12, // batteryProfile << 4 | configProfile
      ...u32(250000), // armingFlags
      0x0a, 0x00, 0x00, 0x00, // boxModeFlags tail (not decoded here)
    ];
    expect(normalise(decodeMspINavStatus(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavMisc", () => {
    const bytes = Array(40).fill(0).map((_, i) => (i * 7) & 0xff);
    expect(normalise(decodeMspINavMisc(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavMisc2", () => {
    const bytes = Array(16).fill(0).map((_, i) => (i * 11) & 0xff);
    expect(normalise(decodeMspINavMisc2(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavSafehome", () => {
    const bytes = [
      0x02, // id
      0x01, // enabled
      ...s32(135000000), // lat
      ...s32(774000000), // lon
    ];
    expect(normalise(decodeMspINavSafehome(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavNavConfigLegacy", () => {
    const bytes = Array(40).fill(0).map((_, i) => (i * 13 + 3) & 0xff);
    expect(normalise(decodeMspINavNavConfigLegacy(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavFwApproach (one slot per reply, 15 bytes)", () => {
    // mspFwApproachOutCommand answers one requested slot: U8 idx, S32
    // approachAlt, S32 landAlt, U8 direction, S16 heading1, S16 heading2,
    // U8 isSeaLevelRef.
    const bytes = [
      0x04, // slot number
      ...s32(5000), // approachAlt cm
      ...s32(1500), // landAlt cm
      0x01, // approachDirection (right)
      ...s16(90), // landHeading1
      ...s16(-90), // landHeading2
      0x01, // isSeaLevelRef
    ];
    expect(decodeMspINavFwApproach(dv(bytes))).toEqual({
      number: 4,
      approachAlt: 5000,
      landAlt: 1500,
      approachDirection: 1,
      landHeading1: 90,
      landHeading2: -90,
      isSeaLevelRef: true,
    });
    expect(() => decodeMspINavFwApproach(dv(bytes.slice(0, 14)))).toThrow(RangeError);
  });

  // ── battery / power ────────────────────────────────────────
  it("decodeMspINavAnalog", () => {
    const bytes = [
      0x01, // batteryState
      ...u16(12600), // voltage mV
      ...u16(850), // rssi
      ...u16(1500), // amperage cA
      ...u32(12345), // mahDrawn
      ...u32(50), // mwhDrawn
      ...u32(678), // batteryRemainingCapacity
      0x4b, // batteryPercent
      ...u16(3000), // power
      ...u16(4200), // cellCount*voltage, etc.
    ];
    expect(normalise(decodeMspINavAnalog(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavBatteryConfig (29-byte FC layout)", () => {
    const bytes = [
      ...u16(1100), // voltage scale
      0x01, // voltage source (sag compensated)
      0x04, // cells
      ...u16(430), // cellDetect (0.01 V)
      ...u16(330), // cellMin
      ...u16(420), // cellMax
      ...u16(350), // cellWarning
      ...u16(25), // current offset
      ...u16(400), // current scale
      ...u32(2200), // capacity
      ...u32(440), // capacity warning
      ...u32(220), // capacity critical
      0x00, // capacity unit (mAh)
    ];
    expect(bytes.length).toBe(29);
    expect(decodeMspINavBatteryConfig(dv(bytes))).toEqual({
      voltageScale: 1100,
      voltageSource: 1,
      cells: 4,
      cellDetect: 430,
      cellMin: 330,
      cellMax: 420,
      cellWarning: 350,
      currentOffset: 25,
      currentScale: 400,
      capacityMah: 2200,
      capacityWarningMah: 440,
      capacityCriticalMah: 220,
      capacityUnit: 0,
    });
  });

  // ── rate / tuning ──────────────────────────────────────────
  it("decodeMspINavRateProfile", () => {
    const bytes = Array(24).fill(0).map((_, i) => (i * 5 + 3) & 0xff);
    expect(normalise(decodeMspINavRateProfile(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavAirSpeed", () => {
    const bytes = [...u32(1750)];
    expect(normalise(decodeMspINavAirSpeed(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavRateDynamics", () => {
    const bytes = [10, 20, 30, 40, 50, 60, 70, 80, 90];
    expect(normalise(decodeMspINavRateDynamics(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavEzTune", () => {
    const bytes = [0x01, ...u16(120), 50, 60, 70, 80, 90, 100, 110, 120];
    expect(normalise(decodeMspINavEzTune(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavMcBraking", () => {
    const bytes = [
      ...u16(100),
      ...u16(200),
      ...u16(5000),
      0x1e,
      ...u16(2000),
      ...u16(150),
      ...u16(250),
      0x2d,
    ];
    expect(normalise(decodeMspINavMcBraking(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavPid (four axes)", () => {
    const bytes = [
      40, 30, 25, 10, // axis 0
      35, 28, 22, 8, // axis 1
      30, 26, 20, 6, // axis 2
      20, 15, 10, 4, // axis 3
    ];
    expect(normalise(decodeMspINavPid(dv(bytes)))).toMatchSnapshot();
  });

  // ── mixer / servo / output ─────────────────────────────────
  it("decodeMspINavServoMixer (two rules)", () => {
    const rule = [0x01, 0x02, ...s16(500), 0x05, 0x04];
    const bytes = [...rule, ...rule];
    expect(normalise(decodeMspINavServoMixer(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavOutputMappingExt2 (6-byte entries: timer, U32 usage, label)", () => {
    const bytes = [
      0x00, ...u32(1 << 2), 0x00, // timer 0, MOTOR
      0x01, ...u32(1 << 3), 0x00, // timer 1, SERVO
      0x02, ...u32(1 << 24), 0x01, // timer 2, LED, LED label
    ];
    expect(decodeMspINavOutputMappingExt2(dv(bytes))).toEqual([
      { timerId: 0, usageFlags: 1 << 2, specialLabels: 0 },
      { timerId: 1, usageFlags: 1 << 3, specialLabels: 0 },
      { timerId: 2, usageFlags: 1 << 24, specialLabels: 1 },
    ]);
  });

  it("decodeMspINavTimerOutputMode (three timers)", () => {
    const bytes = [0x00, 0x01, 0x01, 0x02, 0x02, 0x03];
    expect(normalise(decodeMspINavTimerOutputMode(dv(bytes)))).toMatchSnapshot();
  });

  // ── OSD ────────────────────────────────────────────────────
  it("decodeMspINavOsdLayoutsHeader", () => {
    const bytes = [0x04, 0x50, 0x02];
    expect(normalise(decodeMspINavOsdLayoutsHeader(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavOsdAlarms", () => {
    const bytes = [
      0x64, // rssi
      ...u16(600), // flyMinutes
      ...u16(300), // maxAltitude
      ...u16(5000), // distance
      ...u16(100), // maxNegAltitude
      ...u16(250), // gforce
      ...s16(-500), // gforceAxisMin
      ...s16(500), // gforceAxisMax
      0x28, // current
      ...s16(-50), // imuTempMin
      ...s16(150), // imuTempMax
      ...s16(-40), // baroTempMin
      ...s16(140), // baroTempMax
      ...s16(10000), // adsbDistanceWarning
      ...s16(5000), // adsbDistanceAlert
    ];
    expect(normalise(decodeMspINavOsdAlarms(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavOsdPreferences", () => {
    const bytes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(normalise(decodeMspINavOsdPreferences(dv(bytes)))).toMatchSnapshot();
  });

  // ── sensors ───────────────────────────────────────────────
  it("decodeMspINavTempSensorConfig (two sensors)", () => {
    const sensor = [
      0x01, // type
      ...[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0x11, 0x22, 0x33], // address
      ...s16(-100), // alarmMin
      ...s16(900), // alarmMax
      0x42, 0x41, 0x54, 0x00, // "BAT" null-padded
    ];
    const bytes = [...sensor, ...sensor];
    expect(normalise(decodeMspINavTempSensorConfig(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavTemperatures", () => {
    const bytes = [
      ...s16(250), // sensor 0
      ...s16(-50),
      ...s16(150),
      ...s16(320),
      ...s16(0x7fff),
      ...s16(-20),
      ...s16(440),
      ...s16(0),
    ];
    expect(normalise(decodeMspINavTemperatures(dv(bytes)))).toMatchSnapshot();
  });

  // ── logic / programming ───────────────────────────────────
  it("decodeMspINavLogicConditions (two rules)", () => {
    const rule = [
      0x01, // enabled
      0x00, // activatorId
      0x05, // operation
      0x02, // operandAType
      ...s32(1000), // operandAValue
      0x03, // operandBType
      ...s32(-500), // operandBValue
      0x00, // flags
    ];
    const bytes = [...rule, ...rule];
    expect(normalise(decodeMspINavLogicConditions(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavLogicConditionsStatus (three rules)", () => {
    const bytes = [
      0x00, ...s32(10),
      0x01, ...s32(-20),
      0x02, ...s32(30),
    ];
    expect(normalise(decodeMspINavLogicConditionsStatus(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavGvarStatus", () => {
    // 8 live global variables, each a signed 32-bit value (gvGet(0..7)).
    const bytes: number[] = [];
    for (let i = 0; i < 8; i += 1) bytes.push(...s32(i * 100 - 300));
    expect(normalise(decodeMspINavGvarStatus(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeMspINavProgrammingPid (19-byte record, U16 gains)", () => {
    const bytes = [
      0x01, // enabled
      0x02, // setpointType
      ...s32(1000), // setpointValue
      0x05, // measurementType
      ...s32(-500), // measurementValue
      ...u16(300), ...u16(40), ...u16(1200), ...u16(20), // P / I / D / FF
    ];
    expect(bytes.length).toBe(19);
    expect(decodeMspINavProgrammingPid(dv(bytes))).toEqual([
      {
        enabled: true,
        setpointType: 2,
        setpointValue: 1000,
        measurementType: 5,
        measurementValue: -500,
        gains: { P: 300, I: 40, D: 1200, FF: 20 },
      },
    ]);
  });

  it("decodeMspINavProgrammingPidStatus (one S32 per PID, no index byte)", () => {
    const bytes = [...s32(500), ...s32(-750), ...s32(0)];
    expect(decodeMspINavProgrammingPidStatus(dv(bytes))).toEqual([
      { id: 0, output: 500 },
      { id: 1, output: -750 },
      { id: 2, output: 0 },
    ]);
  });

  // ── ADS-B ─────────────────────────────────────────────────
  it("decodeMspAdsbVehicleList (one vehicle)", () => {
    const callsign = [0x41, 0x42, 0x43, 0x44, 0x00, 0x00, 0x00, 0x00, 0x00]; // "ABCD"
    const bytes = [
      ...callsign,
      ...u32(0x00abcdef), // icao
      ...s32(135000000), // lat
      ...s32(774000000), // lon
      ...s32(1500000), // alt cm
      ...u16(1800), // heading x10
      ...u32(123456), // lastSeenMs
      0x03, // emitterType
      0x78, // ttlSec
    ];
    expect(normalise(decodeMspAdsbVehicleList(dv(bytes)))).toMatchSnapshot();
  });

  // ── common settings ───────────────────────────────────────
  it("decodeCommonSetting", () => {
    const bytes = [0xde, 0xad, 0xbe, 0xef];
    expect(normalise(decodeCommonSetting(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeCommonSettingInfo", () => {
    const name = "nav_mc_pos_z_p";
    const bytes = [
      ...[...name].map((c) => c.charCodeAt(0)), 0, // name + null
      ...u16(0x0123), // pgId
      0x02, // type
      0x00, // section
      0x00, // mode
      ...s32(-100), // min (signed)
      ...u16(100), 0x00, 0x00, // max (unsigned u32)
      ...u16(0x002a), // index
      0x01, // profileCurrent
      0x03, // profileCount
    ];
    expect(normalise(decodeCommonSettingInfo(dv(bytes)))).toMatchSnapshot();
  });

  it("decodeCommonPgList (four ids)", () => {
    const bytes = [
      ...u16(0x0001),
      ...u16(0x0010),
      ...u16(0x0100),
      ...u16(0x1000),
    ];
    expect(normalise(decodeCommonPgList(dv(bytes)))).toMatchSnapshot();
  });
});
