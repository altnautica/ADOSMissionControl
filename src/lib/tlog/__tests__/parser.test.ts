/**
 * @license GPL-3.0-only
 *
 * tlog reading: big-endian block timestamps, MAVLink 2 zero-trimmed payloads,
 * unknown-value sentinels, and the flight summary computed from the log.
 */

import { describe, expect, it } from "vitest";

import { parseTlog, tlogToFlightRecord } from "../parser";

/** A MAVLink 2 frame for `msgId` whose payload is `payload` (already trimmed). */
function v2(msgId: number, payload: Uint8Array): Uint8Array {
  const raw = new Uint8Array(10 + payload.length + 2);
  raw[0] = 0xfd;
  raw[1] = payload.length;
  raw[7] = msgId & 0xff;
  raw[8] = (msgId >> 8) & 0xff;
  raw[9] = (msgId >> 16) & 0xff;
  raw.set(payload, 10);
  return raw;
}

/** MAVLink 2 drops trailing zero bytes from the payload on the wire. */
function trim(payload: Uint8Array): Uint8Array {
  let end = payload.length;
  while (end > 1 && payload[end - 1] === 0) end -= 1;
  return payload.slice(0, end);
}

function globalPositionInt(lat: number, lon: number, relAltM: number, vx = 0, hdgCdeg = 0): Uint8Array {
  const p = new Uint8Array(28);
  const dv = new DataView(p.buffer);
  dv.setInt32(4, Math.round(lat * 1e7), true);
  dv.setInt32(8, Math.round(lon * 1e7), true);
  dv.setInt32(12, Math.round((relAltM + 900) * 1000), true);
  dv.setInt32(16, Math.round(relAltM * 1000), true);
  dv.setInt16(20, Math.round(vx * 100), true);
  dv.setUint16(26, hdgCdeg, true);
  return trim(p);
}

/** Frame a list of (timestampUs, packet) blocks the way a ground station writes them. */
function tlogFile(blocks: Array<[bigint, Uint8Array]>): ArrayBuffer {
  const len = blocks.reduce((n, [, pkt]) => n + 8 + pkt.length, 0);
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  let pos = 0;
  for (const [ts, pkt] of blocks) {
    dv.setBigUint64(pos, ts, false);
    out.set(pkt, pos + 8);
    pos += 8 + pkt.length;
  }
  return out.buffer;
}

const T0 = 1_700_000_000_000_000n; // 2023-11-14, µs since the epoch

describe("parseTlog", () => {
  it("reads the block timestamps big-endian", () => {
    const packets = parseTlog(
      tlogFile([
        [T0, v2(33, globalPositionInt(12, 77, 10))],
        [T0 + 2_000_000n, v2(33, globalPositionInt(12, 77, 10))],
      ]),
    );
    expect(packets.map((p) => p.timestampUs)).toEqual([Number(T0), Number(T0 + 2_000_000n)]);
  });

  it("resynchronises byte by byte after a torn block", () => {
    const good = tlogFile([[T0, v2(33, globalPositionInt(12, 77, 10))]]);
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const joined = new Uint8Array(garbage.length + good.byteLength);
    joined.set(garbage, 0);
    joined.set(new Uint8Array(good), garbage.length);
    const packets = parseTlog(joined.buffer);
    expect(packets).toHaveLength(1);
    expect(packets[0].timestampUs).toBe(Number(T0));
  });
});

describe("tlogToFlightRecord", () => {
  it("decodes a zero-trimmed GLOBAL_POSITION_INT and keeps a north heading", () => {
    const packets = parseTlog(
      tlogFile([
        [T0, v2(33, globalPositionInt(12, 77, 10))],
        [T0 + 1_000_000n, v2(33, globalPositionInt(12.001, 77, 20, 5, 0))],
      ]),
    );
    const result = tlogToFlightRecord(packets);
    const pos = result?.frames.filter((f) => f.channel === "globalPosition") ?? [];
    expect(pos).toHaveLength(2);
    expect(pos[1].data).toMatchObject({ lat: 12.001, relativeAlt: 20, heading: 0 });
  });

  it("leaves an unknown heading and an unmeasured current out", () => {
    const sys = new Uint8Array(31);
    const dv = new DataView(sys.buffer);
    dv.setUint16(14, 15_800, true);
    dv.setInt16(16, -1, true); // current not measured
    dv.setInt8(30, 75);
    const packets = parseTlog(
      tlogFile([
        [T0, v2(33, globalPositionInt(12, 77, 10, 0, 0xffff))],
        [T0 + 1_000_000n, v2(1, trim(sys))],
      ]),
    );
    const frames = tlogToFlightRecord(packets)?.frames ?? [];
    const position = frames.find((f) => f.channel === "globalPosition")?.data;
    const battery = frames.find((f) => f.channel === "battery")?.data;
    expect(position).not.toHaveProperty("heading");
    expect(battery).toEqual({ voltage: 15.8, remaining: 75 });
  });

  it("records no battery frame from a vehicle with no battery monitor", () => {
    const sys = new Uint8Array(31);
    const dv = new DataView(sys.buffer);
    dv.setUint16(14, 0xffff, true);
    dv.setInt16(16, -1, true);
    dv.setInt8(30, -1);
    const packets = parseTlog(
      tlogFile([
        [T0, v2(33, globalPositionInt(12, 77, 10))],
        [T0 + 1_000_000n, v2(1, sys)],
      ]),
    );
    const frames = tlogToFlightRecord(packets)?.frames ?? [];
    expect(frames.some((f) => f.channel === "battery")).toBe(false);
  });

  it("dates the flight from the log and sums the distance flown", () => {
    const packets = parseTlog(
      tlogFile([
        [T0, v2(33, globalPositionInt(12, 77, 10, 3))],
        [T0 + 10_000_000n, v2(33, globalPositionInt(12.001, 77, 10, 3))],
      ]),
    );
    const record = tlogToFlightRecord(packets)?.record;
    expect(record?.startTime).toBe(Number(T0 / 1000n));
    expect(record?.duration).toBe(10);
    expect(record?.distance).toBeGreaterThan(110);
    expect(record?.distance).toBeLessThan(112);
    expect(record?.maxSpeed).toBeCloseTo(3, 5);
  });
});
