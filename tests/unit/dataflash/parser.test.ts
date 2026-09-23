/**
 * The DataFlash `.bin` parser against a synthetic log built frame by frame in
 * the on-disk layout: `A3 95 <type>` then the payload, with every message type
 * declared by an FMT record (type 0x80, 89 bytes: Type B, Length B, Name n,
 * Format N, Columns Z). Nothing here is produced by the parser's own code.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { parseDataflashLog } from "@/lib/dataflash/parser";
import { dataflashToFlightRecords } from "@/lib/dataflash/to-flight-record";

/** Little-endian writer for one message payload, per DataFlash format char. */
function payload(format: string, values: (number | string)[]): number[] {
  const out: number[] = [];
  const view = new DataView(new ArrayBuffer(8));
  const push = (n: number) => out.push(...new Uint8Array(view.buffer, 0, n));
  const text = (s: string, width: number) => {
    for (let i = 0; i < width; i++) out.push(i < s.length ? s.charCodeAt(i) : 0);
  };
  [...format].forEach((ch, i) => {
    const v = values[i];
    switch (ch) {
      case "B": view.setUint8(0, Number(v)); push(1); break;
      case "I": view.setUint32(0, Number(v), true); push(4); break;
      case "f": view.setFloat32(0, Number(v), true); push(4); break;
      // Raw IEEE 754 half-precision bits.
      case "g": view.setUint16(0, Number(v), true); push(2); break;
      case "c": view.setInt16(0, Math.round(Number(v) * 100), true); push(2); break;
      case "C": view.setUint16(0, Math.round(Number(v) * 100), true); push(2); break;
      case "L": view.setInt32(0, Math.round(Number(v) * 1e7), true); push(4); break;
      case "Q": view.setBigUint64(0, BigInt(v), true); push(8); break;
      case "n": text(String(v), 4); break;
      case "N": text(String(v), 16); break;
      case "Z": text(String(v), 64); break;
      default: throw new Error(`test writer lacks format char ${ch}`);
    }
  });
  return out;
}

const WIDTH: Record<string, number> = { B: 1, I: 4, f: 4, g: 2, c: 2, C: 2, L: 4, Q: 8, n: 4, N: 16, Z: 64 };

interface MsgDef {
  type: number;
  name: string;
  format: string;
  columns: string;
}

const FMT: MsgDef = { type: 0x80, name: "FMT", format: "BBnNZ", columns: "Type,Length,Name,Format,Columns" };
const PARM: MsgDef = { type: 64, name: "PARM", format: "QNf", columns: "TimeUS,Name,Value" };
const EV: MsgDef = { type: 65, name: "EV", format: "QB", columns: "TimeUS,Id" };
const POS: MsgDef = { type: 66, name: "POS", format: "QLLff", columns: "TimeUS,Lat,Lng,Alt,RelHomeAlt" };
const ATT: MsgDef = { type: 67, name: "ATT", format: "QccC", columns: "TimeUS,Roll,Pitch,Yaw" };
const VIBE: MsgDef = { type: 68, name: "VIBE", format: "QBfffI", columns: "TimeUS,IMU,VibeX,VibeY,VibeZ,Clip" };
const BAT: MsgDef = { type: 69, name: "BAT", format: "QBff", columns: "TimeUS,Inst,Volt,Curr" };
const GPS: MsgDef = { type: 70, name: "GPS", format: "QBBf", columns: "TimeUS,I,NSats,HDop" };
/** Half-precision fields: 1.5 is 0x3e00, -2 is 0xc000, 65504 is 0x7bff. */
const HALF: MsgDef = { type: 71, name: "HALF", format: "Qggg", columns: "TimeUS,A,B,C" };

const length = (d: MsgDef) => 3 + [...d.format].reduce((n, ch) => n + WIDTH[ch], 0);

function frame(def: MsgDef, values: (number | string)[]): number[] {
  return [0xa3, 0x95, def.type, ...payload(def.format, values)];
}

function declare(def: MsgDef): number[] {
  return frame(FMT, [def.type, length(def), def.name, def.format, def.columns]);
}

function log(...frames: number[][]): Uint8Array {
  return new Uint8Array(frames.flat());
}

const HEADER = [
  declare(FMT),
  declare(PARM),
  declare(EV),
  declare(POS),
  declare(ATT),
  declare(VIBE),
  declare(BAT),
];

describe("parseDataflashLog", () => {
  it("walks a clean log frame by frame with no resync", () => {
    const bytes = log(
      ...HEADER,
      frame(PARM, [1_000, "SYSID_THISMAV", 7]),
      frame(ATT, [2_000, 1.5, -2.25, 359.99]),
    );
    const parsed = parseDataflashLog(bytes);
    expect(parsed.resyncSkipped).toBe(0);
    expect(parsed.bytesRead).toBe(bytes.length);
    expect(parsed.formats.get(ATT.type)).toMatchObject({ name: "ATT", length: length(ATT) });
  });

  it("decodes scaled fields at their declared offsets", () => {
    const parsed = parseDataflashLog(
      log(
        ...HEADER,
        frame(PARM, [1_000, "SYSID_THISMAV", 7]),
        frame(POS, [3_000, 12.9715987, 77.5945627, 920.5, 12.25]),
        frame(ATT, [2_000, 1.5, -2.25, 359.99]),
      ),
    );
    expect(parsed.params.get("SYSID_THISMAV")).toBe(7);
    const [pos] = parsed.messages.get("POS")!;
    expect(pos.Lat).toBeCloseTo(12.9715987, 7);
    expect(pos.Lng).toBeCloseTo(77.5945627, 7);
    expect(pos.RelHomeAlt).toBeCloseTo(12.25, 5);
    expect(parsed.messages.get("ATT")![0]).toMatchObject({ TimeUS: 2_000, Roll: 1.5, Pitch: -2.25, Yaw: 359.99 });
  });

  it("keeps the instance of every multi-instance row", () => {
    const parsed = parseDataflashLog(
      log(
        ...HEADER,
        frame(VIBE, [1_000, 0, 1.5, 2.5, 3.5, 0]),
        frame(VIBE, [1_000, 1, 9.5, 9.5, 9.5, 4]),
        frame(BAT, [1_000, 0, 16.4, 12.5]),
        frame(BAT, [1_000, 1, 8.1, 0.5]),
      ),
    );
    expect(parsed.messages.get("VIBE")!.map((r) => [r.IMU, r.VibeX, r.Clip])).toEqual([
      [0, 1.5, 0],
      [1, 9.5, 4],
    ]);
    const bat = parsed.messages.get("BAT")!;
    expect(bat.map((r) => r.Inst)).toEqual([0, 1]);
    expect(bat[0].Volt).toBeCloseTo(16.4, 5);
    expect(bat[1].Volt).toBeCloseTo(8.1, 5);
  });

  it("stops cleanly at a truncated final frame", () => {
    const whole = log(...HEADER, frame(ATT, [2_000, 1, 2, 3]), frame(ATT, [3_000, 4, 5, 6]));
    const parsed = parseDataflashLog(whole.subarray(0, whole.length - 2));
    expect(parsed.messages.get("ATT")).toHaveLength(1);
  });

  it("decodes only the requested messages and still walks every frame", () => {
    const bytes = log(
      ...HEADER,
      frame(PARM, [1_000, "SYSID_THISMAV", 7]),
      frame(VIBE, [1_000, 0, 1.5, 2.5, 3.5, 0]),
      frame(ATT, [2_000, 1, 2, 3]),
    );
    const parsed = parseDataflashLog(bytes, { only: new Set(["ATT"]) });
    expect([...parsed.messages.keys()]).toEqual(["ATT"]);
    expect(parsed.params.get("SYSID_THISMAV")).toBe(7);
    expect(parsed.resyncSkipped).toBe(0);
    expect(parsed.bytesRead).toBe(bytes.length);
  });

  it("decodes float16 fields", () => {
    const parsed = parseDataflashLog(log(...HEADER, declare(HALF), frame(HALF, [1_000, 0x3e00, 0xc000, 0x7bff])));
    expect(parsed.messages.get("HALF")![0]).toMatchObject({ A: 1.5, B: -2, C: 65504 });
  });

  it("steps over a message type it cannot decode and parses the rest", () => {
    // An FMT naming a format char this reader has no decoder for, 4 bytes wide on disk.
    const odd: MsgDef = { type: 72, name: "ODD", format: "QX", columns: "TimeUS,Val" };
    const oddDecl = frame(FMT, [odd.type, 3 + 8 + 4, odd.name, odd.format, odd.columns]);
    const oddFrame = [0xa3, 0x95, odd.type, ...payload("Q", [1_000]), 1, 2, 3, 4];
    const bytes = log(...HEADER, oddDecl, oddFrame, frame(ATT, [2_000, 1, 2, 3]));
    const parsed = parseDataflashLog(bytes);
    expect(parsed.messages.has("ODD")).toBe(false);
    expect(parsed.messages.get("ATT")).toHaveLength(1);
    expect(parsed.resyncSkipped).toBe(0);
    expect(parsed.bytesRead).toBe(bytes.length);
  });
});

describe("dataflash .bin to flight records", () => {
  it("imports a log that ends while still armed as a flight up to the last sample", () => {
    const parsed = parseDataflashLog(
      log(
        ...HEADER,
        frame(PARM, [0, "SYSID_THISMAV", 3]),
        frame(EV, [1_000_000, 10]), // armed
        frame(POS, [1_500_000, 12.97, 77.59, 920, 0]),
        frame(ATT, [2_000_000, 0, 0, 90]),
        frame(POS, [9_000_000, 12.971, 77.591, 950, 30]),
        // No disarm: the log ends mid-flight (brown-out, crash).
      ),
    );
    const flights = dataflashToFlightRecords(parsed);
    expect(flights).toHaveLength(1);
    expect(flights[0].record.droneId).toBe("dataflash-sysid-3");
    expect(flights[0].record.duration).toBe(8);
    expect(flights[0].record.maxAlt).toBeCloseTo(30, 5);
  });

  it("takes levels, battery and GPS from the first instance and each IMU's clip count", () => {
    const parsed = parseDataflashLog(
      log(
        ...HEADER,
        declare(GPS),
        frame(EV, [1_000_000, 10]),
        frame(VIBE, [2_000_000, 0, 1.5, 2.5, 3.5, 7]),
        frame(VIBE, [2_000_000, 1, 9.5, 9.5, 9.5, 4]),
        frame(VIBE, [2_000_000, 2, 8.5, 8.5, 8.5, 0]),
        frame(BAT, [2_000_000, 0, 22.2, 12.5]),
        frame(BAT, [2_000_000, 1, 5.1, 0.5]),
        frame(GPS, [2_000_000, 0, 14, 0.8]),
        frame(GPS, [2_000_000, 1, 6, 2.5]),
        frame(BAT, [3_000_000, 0, 21.9, 12.0]),
        frame(BAT, [3_000_000, 1, 5.0, 0.5]),
        frame(EV, [4_000_000, 11]),
      ),
    );
    const [flight] = dataflashToFlightRecords(parsed);
    const vibe = flight.frames.filter((f) => f.channel === "vibration").map((f) => f.data);
    expect(vibe).toHaveLength(1);
    expect(vibe[0]).toMatchObject({ vibrationX: 1.5, clipping0: 7, clipping1: 4, clipping2: 0 });
    const battery = flight.frames.filter((f) => f.channel === "battery").map((f) => f.data);
    expect(battery).toEqual([
      expect.objectContaining({ voltage: expect.closeTo(22.2, 5) }),
      expect.objectContaining({ voltage: expect.closeTo(21.9, 5) }),
    ]);
    expect(flight.record.batteryStartV).toBeCloseTo(22.2, 5);
    expect(flight.record.batteryEndV).toBeCloseTo(21.9, 5);
    const gps = flight.frames.filter((f) => f.channel === "gps").map((f) => f.data);
    expect(gps).toEqual([expect.objectContaining({ satellites: 14 })]);
  });

  it("leaves clipping absent when the log carries no clip count", () => {
    const noClip: MsgDef = { type: 73, name: "VIBE", format: "Qfff", columns: "TimeUS,VibeX,VibeY,VibeZ" };
    const parsed = parseDataflashLog(
      log(
        declare(FMT),
        declare(EV),
        declare(noClip),
        frame(EV, [1_000_000, 10]),
        frame(noClip, [2_000_000, 1.5, 2.5, 3.5]),
        frame(EV, [3_000_000, 11]),
      ),
    );
    const vibe = dataflashToFlightRecords(parsed)[0].frames.find((f) => f.channel === "vibration")!.data;
    expect(vibe).toMatchObject({ vibrationX: 1.5 });
    expect(vibe).not.toHaveProperty("clipping0");
  });

  it("skips a position row that carries no altitude", () => {
    const noAlt: MsgDef = { type: 74, name: "POS", format: "QLL", columns: "TimeUS,Lat,Lng" };
    const parsed = parseDataflashLog(
      log(
        declare(FMT),
        declare(EV),
        declare(noAlt),
        frame(EV, [1_000_000, 10]),
        frame(noAlt, [2_000_000, 12.97, 77.59]),
        frame(EV, [3_000_000, 11]),
      ),
    );
    const [flight] = dataflashToFlightRecords(parsed);
    expect(flight.frames.some((f) => f.channel === "position")).toBe(false);
  });
});
