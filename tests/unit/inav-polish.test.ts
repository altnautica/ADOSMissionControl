/**
 * Tests for the iNav polish encoder functions and capability flag wiring.
 *
 * Covers: EzTune encoder layout, FwApproach encoder layout, OSD alarms
 * and preferences pass-through, custom OSD element encoder, and the
 * capability keys that gate the new nav items in DroneConfigureTab.
 *
 * All tests run offline -- no flight controller required.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  encodeMspINavSetEzTune,
  encodeMspINavSetFwApproach,
  encodeMspINavSetOsdAlarms,
  encodeMspINavSetOsdPreferences,
  encodeMspINavSetCustomOsdElement,
} from "@/lib/protocol/msp/msp-encoders-inav";
import type { INavFwApproach, INavOsdAlarms, INavOsdPreferences, INavCustomOsdElement, INavCustomOsdField, INavCustomOsdElementsInfo } from "@/lib/protocol/msp/msp-decoders-inav";
import type { INavEzTune } from "@/lib/protocol/msp/msp-decoders-inav";
import { decodeMspINavCustomOsdElement } from "@/lib/protocol/msp/msp-decoders-inav";

// ── EzTune encoder ────────────────────────────────────────────

describe("encodeMspINavSetEzTune", () => {
  it("produces an 11-byte buffer", () => {
    const cfg: INavEzTune = {
      enabled: true,
      filterHz: 120,
      axisRatio: 110,
      response: 80,
      damping: 90,
      stability: 70,
      aggressiveness: 60,
      rate: 50,
      expo: 40,
      snappiness: 30,
    };
    const buf = encodeMspINavSetEzTune(cfg);
    expect(buf.byteLength).toBe(11);
  });

  it("encodes enabled flag as 1 in byte 0", () => {
    const cfg: INavEzTune = {
      enabled: true,
      filterHz: 100,
      axisRatio: 100,
      response: 100,
      damping: 100,
      stability: 100,
      aggressiveness: 100,
      rate: 100,
      expo: 100,
      snappiness: 100,
    };
    const buf = encodeMspINavSetEzTune(cfg);
    expect(buf[0]).toBe(1);
  });

  it("encodes disabled flag as 0 in byte 0", () => {
    const cfg: INavEzTune = {
      enabled: false,
      filterHz: 100,
      axisRatio: 100,
      response: 50,
      damping: 50,
      stability: 50,
      aggressiveness: 50,
      rate: 50,
      expo: 50,
      snappiness: 50,
    };
    const buf = encodeMspINavSetEzTune(cfg);
    expect(buf[0]).toBe(0);
  });

  it("encodes filterHz as little-endian U16 in bytes 1-2", () => {
    const cfg: INavEzTune = {
      enabled: false,
      filterHz: 256,
      axisRatio: 0,
      response: 0,
      damping: 0,
      stability: 0,
      aggressiveness: 0,
      rate: 0,
      expo: 0,
      snappiness: 0,
    };
    const buf = encodeMspINavSetEzTune(cfg);
    const dv = new DataView(buf.buffer);
    expect(dv.getUint16(1, true)).toBe(256);
  });
});

// ── FwApproach encoder ────────────────────────────────────────

describe("encodeMspINavSetFwApproach", () => {
  it("produces a 15-byte buffer", () => {
    const a: INavFwApproach = {
      number: 0,
      approachAlt: 5000,
      landAlt: 100,
      approachDirection: 0,
      landHeading1: 90,
      landHeading2: 270,
      isSeaLevelRef: false,
    };
    const buf = encodeMspINavSetFwApproach(a);
    expect(buf.byteLength).toBe(15);
  });

  it("encodes slot number in byte 0", () => {
    const a: INavFwApproach = {
      number: 3,
      approachAlt: 0,
      landAlt: 0,
      approachDirection: 0,
      landHeading1: 0,
      landHeading2: 0,
      isSeaLevelRef: false,
    };
    const buf = encodeMspINavSetFwApproach(a);
    expect(buf[0]).toBe(3);
  });

  it("encodes isSeaLevelRef as 1 when true", () => {
    const a: INavFwApproach = {
      number: 0,
      approachAlt: 0,
      landAlt: 0,
      approachDirection: 0,
      landHeading1: 0,
      landHeading2: 0,
      isSeaLevelRef: true,
    };
    const buf = encodeMspINavSetFwApproach(a);
    expect(buf[14]).toBe(1);
  });
});

// ── OSD alarms encoder ────────────────────────────────────────

describe("encodeMspINavSetOsdAlarms", () => {
  const zeroAlarms: INavOsdAlarms = {
    rssi: 0, flyMinutes: 0, maxAltitude: 0, distance: 0,
    maxNegAltitude: 0, gforce: 0, gforceAxisMin: 0, gforceAxisMax: 0,
    current: 0, imuTempMin: 0, imuTempMax: 0,
    baroTempMin: 0, baroTempMax: 0, adsbDistanceWarning: 0, adsbDistanceAlert: 0,
  };

  it("produces the 24-byte frame the firmware accepts, without the ADS-B read-only tail", () => {
    const buf = encodeMspINavSetOsdAlarms({ ...zeroAlarms, adsbDistanceWarning: 20000, adsbDistanceAlert: 3000 });
    expect(buf.byteLength).toBe(24);
  });

  it("encodes g-force as g x1000 and signed axis limits, and baro temps at the tail", () => {
    const buf = encodeMspINavSetOsdAlarms({
      ...zeroAlarms, gforce: 5000, gforceAxisMin: -5000, gforceAxisMax: 5000, baroTempMax: -100,
    });
    const dv = new DataView(buf.buffer);
    expect(dv.getUint16(9, true)).toBe(5000);
    expect(dv.getInt16(11, true)).toBe(-5000);
    expect(dv.getInt16(13, true)).toBe(5000);
    expect(dv.getInt16(22, true)).toBe(-100);
  });

  it("encodes rssi as U8 in byte 0", () => {
    const a: INavOsdAlarms = { ...zeroAlarms, rssi: 42 };
    const buf = encodeMspINavSetOsdAlarms(a);
    expect(new Uint8Array(buf)[0]).toBe(42);
  });

  it("encodes flyMinutes as U8 in byte 1", () => {
    const a: INavOsdAlarms = { ...zeroAlarms, flyMinutes: 30 };
    const buf = encodeMspINavSetOsdAlarms(a);
    expect(new Uint8Array(buf)[1]).toBe(30);
  });
});

// ── OSD preferences encoder ───────────────────────────────────

describe("encodeMspINavSetOsdPreferences", () => {
  const zeroPrefs: INavOsdPreferences = {
    videoSystem: 0, mainVoltageDecimals: 0, ahiReverseRoll: 0,
    crosshairsStyle: 0, leftSidebarScroll: 0, rightSidebarScroll: 0,
    sidebarScrollArrows: 0, units: 0, statsEnergyUnit: 0, adsbWarningStyle: 0,
  };

  it("produces a 10-byte buffer", () => {
    const buf = encodeMspINavSetOsdPreferences(zeroPrefs);
    expect(buf.byteLength).toBe(10);
  });

  it("encodes videoSystem in byte 0", () => {
    const p: INavOsdPreferences = { ...zeroPrefs, videoSystem: 2 };
    const buf = encodeMspINavSetOsdPreferences(p);
    expect(buf[0]).toBe(2);
  });

  it("encodes units in byte 7", () => {
    const p: INavOsdPreferences = { ...zeroPrefs, units: 1 };
    const buf = encodeMspINavSetOsdPreferences(p);
    expect(buf[7]).toBe(1);
  });
});

// ── Custom OSD element encoder ────────────────────────────────

describe("encodeMspINavSetCustomOsdElement", () => {
  // The FC reports its element geometry; the encoder sizes the frame against
  // it, so a payload always matches the length the firmware checks.
  const INFO: INavCustomOsdElementsInfo = { maxElements: 60, partCount: 0, textLength: 14 };
  const el = (parts: INavCustomOsdField[], visibility: INavCustomOsdField, text: string): INavCustomOsdElement =>
    ({ index: 0, parts, visibility, text });
  const VIS = (type: number, value: number): INavCustomOsdField => ({ type, value });

  it("produces an 18-byte buffer (1 + partCount*3 + 3 + 14 text)", () => {
    const buf = encodeMspINavSetCustomOsdElement(el([], VIS(0, 0), ""), INFO);
    expect(buf.byteLength).toBe(18);
  });

  it("encodes index in byte 0", () => {
    const buf = encodeMspINavSetCustomOsdElement(
      { index: 5, parts: [], visibility: VIS(0, 0), text: "" },
      INFO,
    );
    expect(buf[0]).toBe(5);
  });

  it("encodes the visibility type and value in bytes 1-3", () => {
    const buf = encodeMspINavSetCustomOsdElement(
      el([], VIS(2, 7), ""),
      INFO,
    );
    expect(buf[1]).toBe(2);
    expect(buf[2]).toBe(7);
    expect(buf[3]).toBe(0);
  });

  it("encodes parts as (type, U16 value) triples before the visibility rule", () => {
    const buf = encodeMspINavSetCustomOsdElement(
      { index: 0, parts: [VIS(1, 0x1234)], visibility: VIS(2, 7), text: "" },
      { maxElements: 60, partCount: 1, textLength: 11 },
    );
    expect(buf[0]).toBe(0);
    expect(buf[1]).toBe(1);
    expect(buf[2]).toBe(0x34);
    expect(buf[3]).toBe(0x12);
    expect(buf[4]).toBe(2);   // visibility type follows the parts
    expect(buf[5]).toBe(7);
    expect(buf.byteLength).toBe(18);
  });

  it("encodes ASCII text after the visibility rule", () => {
    const buf = encodeMspINavSetCustomOsdElement(el([], VIS(1, 0), "AB"), INFO);
    expect(buf[4]).toBe(0x41); // 'A'
    expect(buf[5]).toBe(0x42); // 'B'
    expect(buf[6]).toBe(0x00); // NUL padding
  });

  it("truncates text longer than textLength characters", () => {
    const text = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 26 chars
    const buf = encodeMspINavSetCustomOsdElement(el([], VIS(1, 0), text), INFO);
    // Bytes 4..17 hold the first 14 chars; no overflow
    const decoded = Array.from(buf.slice(4)).map((b) => (b === 0 ? "" : String.fromCharCode(b))).join("");
    expect(decoded).toBe("ABCDEFGHIJKLMN");
  });
});

// ── Custom OSD element read-back ──────────────────────────────

describe("decodeMspINavCustomOsdElement", () => {
  it("reads back what the SET frame wrote (the reply is the frame without its index)", () => {
    const info: INavCustomOsdElementsInfo = { maxElements: 8, partCount: 3, textLength: 15 };
    const element: INavCustomOsdElement = {
      index: 4,
      parts: [{ type: 1, value: 0x0102 }, { type: 3, value: 7 }, { type: 0, value: 0 }],
      visibility: { type: 2, value: 5 },
      text: "HELLO",
    };
    const frame = encodeMspINavSetCustomOsdElement(element, info);
    const reply = frame.slice(1);
    const decoded = decodeMspINavCustomOsdElement(new DataView(reply.buffer, reply.byteOffset, reply.byteLength), 4, info);
    expect(decoded).toEqual(element);
  });

  it("refuses a reply shorter than the reported geometry", () => {
    const info: INavCustomOsdElementsInfo = { maxElements: 8, partCount: 3, textLength: 15 };
    expect(() => decodeMspINavCustomOsdElement(new DataView(new ArrayBuffer(10)), 0, info)).toThrow(RangeError);
  });
});
