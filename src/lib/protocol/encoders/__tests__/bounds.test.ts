/**
 * @license GPL-3.0-only
 *
 * Encoders used to narrow an out-of-range value into a valid-looking one, which
 * turns a caller's mistake into a different plausible instruction on the wire
 * instead of an error. These tests pin the refusal at each field's boundary,
 * and pin that a value inside the range still encodes to the same bytes.
 */

import { describe, it, expect } from "vitest";

import { writeU8, writeU16, writeI16, writeI32, writeBits16, setU8 } from "../bounds";
import { encodeManualControl, encodeRcChannelsOverride } from "../control";
import { encodeMissionItemInt } from "../mission";
import { encodeMspSetWp } from "../../msp/decoders/inav/nav";
import type { INavWaypoint } from "../../msp/decoders/inav/types";

describe("checked integer writers", () => {
  function dv(size = 8): DataView {
    return new DataView(new ArrayBuffer(size));
  }

  it("accepts the ends of each range", () => {
    expect(() => writeU8(dv(), 0, 0, "f")).not.toThrow();
    expect(() => writeU8(dv(), 0, 255, "f")).not.toThrow();
    expect(() => writeU16(dv(), 0, 65535, "f")).not.toThrow();
    expect(() => writeI16(dv(), 0, -32768, "f")).not.toThrow();
    expect(() => writeI16(dv(), 0, 32767, "f")).not.toThrow();
    expect(() => writeI32(dv(), 0, -2147483648, "f")).not.toThrow();
    expect(() => writeI32(dv(), 0, 2147483647, "f")).not.toThrow();
  });

  it.each([
    ["u8 over", () => writeU8(dv(), 0, 256, "f")],
    ["u8 under", () => writeU8(dv(), 0, -1, "f")],
    ["u16 over", () => writeU16(dv(), 0, 65536, "f")],
    ["u16 under", () => writeU16(dv(), 0, -1, "f")],
    ["i16 over", () => writeI16(dv(), 0, 32768, "f")],
    ["i16 under", () => writeI16(dv(), 0, -32769, "f")],
    ["i32 over", () => writeI32(dv(), 0, 2147483648, "f")],
    ["byte store over", () => setU8(new Uint8Array(4), 0, 256, "f")],
  ])("refuses %s", (_label, write) => {
    expect(write).toThrow(RangeError);
  });

  it.each([
    ["a fraction", 1.5],
    ["NaN", Number.NaN],
    ["infinity", Number.POSITIVE_INFINITY],
  ])("refuses %s", (_label, value) => {
    expect(() => writeU8(dv(), 0, value, "f")).toThrow(RangeError);
  });

  it("names the field in the error so the caller can find it", () => {
    expect(() => writeU8(dv(), 0, 256, "waypoint number")).toThrow(/waypoint number/);
  });

  it("accepts both halves of a field read signed and written unsigned", () => {
    expect(() => writeBits16(dv(), 0, -32768, "f")).not.toThrow();
    expect(() => writeBits16(dv(), 0, 65535, "f")).not.toThrow();
    expect(() => writeBits16(dv(), 0, 65536, "f")).toThrow(RangeError);
    expect(() => writeBits16(dv(), 0, -32769, "f")).toThrow(RangeError);
  });

  it("writes the same bit pattern for either half", () => {
    const a = dv();
    const b = dv();
    writeBits16(a, 0, -1, "f");
    writeBits16(b, 0, 0xffff, "f");
    expect(new Uint8Array(a.buffer)).toEqual(new Uint8Array(b.buffer));
  });
});

describe("iNav waypoint encoding", () => {
  function wp(over: Partial<INavWaypoint> = {}): INavWaypoint {
    return {
      number: 1,
      action: 1,
      lat: 12.34,
      lon: 56.78,
      altitude: 100,
      p1: 0,
      p2: 0,
      p3: 0,
      flag: 0,
      ...over,
    } as INavWaypoint;
  }

  it("encodes a valid waypoint to the expected 21-byte payload", () => {
    const out = encodeMspSetWp(wp({ number: 3, action: 1, altitude: 5000 }));
    expect(out).toHaveLength(21);
    expect(out[0]).toBe(3);
    expect(out[1]).toBe(1);
  });

  it("refuses a waypoint number past the byte the field has", () => {
    // Silently narrowing 256 to 0 aimed the write at the first mission item.
    expect(() => encodeMspSetWp(wp({ number: 256 }))).toThrow(RangeError);
  });

  it("accepts the last addressable waypoint number", () => {
    expect(() => encodeMspSetWp(wp({ number: 255 }))).not.toThrow();
  });

  it("refuses an action, flag or 16-bit parameter outside its field", () => {
    expect(() => encodeMspSetWp(wp({ action: 300 }))).toThrow(RangeError);
    expect(() => encodeMspSetWp(wp({ flag: -1 }))).toThrow(RangeError);
    expect(() => encodeMspSetWp(wp({ p1: 70000 }))).toThrow(RangeError);
    expect(() => encodeMspSetWp(wp({ p3: -40000 }))).toThrow(RangeError);
  });

  it("still accepts a negative parameter, which the reader takes as signed", () => {
    expect(() => encodeMspSetWp(wp({ p1: -500 }))).not.toThrow();
  });
});

describe("MANUAL_CONTROL encoding", () => {
  it("accepts the ends of the documented axis range", () => {
    expect(() => encodeManualControl(1, -1000, 1000, 0, -1000, 0)).not.toThrow();
  });

  it("refuses an axis past the documented range", () => {
    expect(() => encodeManualControl(1, 1001, 0, 0, 0, 0)).toThrow(RangeError);
    expect(() => encodeManualControl(1, 0, -1001, 0, 0, 0)).toThrow(RangeError);
    expect(() => encodeManualControl(1, 0, 0, 1001, 0, 0)).toThrow(RangeError);
    expect(() => encodeManualControl(1, 0, 0, 0, -1001, 0)).toThrow(RangeError);
  });

  it("refuses a button mask wider than the field", () => {
    expect(() => encodeManualControl(1, 0, 0, 0, 0, 0x10000)).toThrow(RangeError);
  });

  it("refuses a target system id past a byte", () => {
    expect(() => encodeManualControl(256, 0, 0, 0, 0, 0)).toThrow(RangeError);
  });
});

describe("RC_CHANNELS_OVERRIDE encoding", () => {
  it("accepts release, a normal pulse width, and the ignore sentinel", () => {
    expect(() => encodeRcChannelsOverride(1, 1, [0, 1500, 65535])).not.toThrow();
  });

  it("refuses a channel value the field cannot hold", () => {
    expect(() => encodeRcChannelsOverride(1, 1, [65536])).toThrow(RangeError);
    expect(() => encodeRcChannelsOverride(1, 1, [-1])).toThrow(RangeError);
  });
});

describe("MISSION_ITEM_INT encoding", () => {
  const item = (over: Partial<Record<string, number>> = {}) => {
    const d = {
      targetSys: 1, targetComp: 1, seq: 0, frame: 3, command: 16,
      current: 0, autocontinue: 1, x: 123456789, y: 987654321,
      ...over,
    };
    return () =>
      encodeMissionItemInt(
        d.targetSys, d.targetComp, d.seq, d.frame, d.command,
        d.current, d.autocontinue, 0, 0, 0, 0, d.x, d.y, 50,
      );
  };

  it("encodes a valid item", () => {
    expect(item()).not.toThrow();
    // The encoder returns a framed message, not the bare payload.
    expect(item()().length).toBeGreaterThan(37);
  });

  it("refuses a sequence number past the 16-bit field", () => {
    expect(item({ seq: 65536 })).toThrow(RangeError);
  });

  it("refuses a command id past the 16-bit field", () => {
    expect(item({ command: 65536 })).toThrow(RangeError);
  });

  it("refuses a frame, current or autocontinue byte past its field", () => {
    // These were raw byte stores, so 256 became 0 and changed the frame.
    expect(item({ frame: 256 })).toThrow(RangeError);
    expect(item({ current: -1 })).toThrow(RangeError);
    expect(item({ autocontinue: 256 })).toThrow(RangeError);
  });

  it("refuses a coordinate past the 32-bit field", () => {
    expect(item({ x: 2147483648 })).toThrow(RangeError);
  });

  it("accepts the ends of the sequence and coordinate ranges", () => {
    expect(item({ seq: 65535, x: 2147483647, y: -2147483648 })).not.toThrow();
  });
});
