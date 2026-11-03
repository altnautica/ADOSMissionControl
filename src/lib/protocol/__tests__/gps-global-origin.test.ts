/**
 * @license GPL-3.0-only
 *
 * GPS_GLOBAL_ORIGIN (msg 49): id, CRC_EXTRA and canonical length as the
 * MAVLink common definition states them (CRC_EXTRA 39, 12-byte base, 20
 * with the time_usec extension), then wire bytes through the real parser,
 * decoder and handler.
 */

import { describe, expect, it } from "vitest";

import { CRC_EXTRA, MAVLinkParser, PAYLOAD_LENGTHS, type MAVLinkFrame } from "../mavlink-parser";
import { buildFrame } from "../encoders/frame";
import { decodeGpsGlobalOrigin } from "../messages";
import { MSG_NAMES } from "../messages/msg-names";
import { handleGpsGlobalOrigin } from "../handlers/nav-safety-handlers";
import type { GpsOriginData } from "@/lib/types";

function payload(lat: number, lon: number, altMm: number, timeUsec?: bigint): Uint8Array {
  const buf = new Uint8Array(timeUsec === undefined ? 12 : 20);
  const dv = new DataView(buf.buffer);
  dv.setInt32(0, lat, true);
  dv.setInt32(4, lon, true);
  dv.setInt32(8, altMm, true);
  if (timeUsec !== undefined) dv.setBigUint64(12, timeUsec, true);
  return buf;
}

function receive(bytes: Uint8Array): MAVLinkFrame {
  const parser = new MAVLinkParser();
  const frames: MAVLinkFrame[] = [];
  parser.onFrame((f) => frames.push(f));
  parser.feed(buildFrame(49, bytes, 1, 1));
  expect(frames).toHaveLength(1);
  return frames[0];
}

describe("GPS_GLOBAL_ORIGIN", () => {
  it("is registered with the definition's seed, length and name", () => {
    expect(CRC_EXTRA.get(49)).toBe(39);
    expect(PAYLOAD_LENGTHS.get(49)).toBe(20);
    expect(MSG_NAMES[49]).toBe("GPS_GLOBAL_ORIGIN");
  });

  it("decodes latitude, longitude, altitude and the time extension", () => {
    const frame = receive(payload(123456789, -987654321, 905123, 1_700_000_000_000_000n));
    expect(frame.msgId).toBe(49);
    expect(decodeGpsGlobalOrigin(frame.payload)).toEqual({
      lat: 123456789,
      lon: -987654321,
      alt: 905123,
      timeUsec: 1_700_000_000_000_000,
    });
  });

  it("restores a frame without the extension and reports time 0", () => {
    const frame = receive(payload(10, 20, 30));
    expect(frame.payload.byteLength).toBe(20);
    expect(decodeGpsGlobalOrigin(frame.payload).timeUsec).toBe(0);
  });

  it("hands subscribers degrees and metres", () => {
    const frame = receive(payload(-337890123, 1511234567, 905123));
    const out: GpsOriginData[] = [];
    handleGpsGlobalOrigin(frame.payload, [(d) => out.push(d)]);
    expect(out).toHaveLength(1);
    expect(out[0].lat).toBeCloseTo(-33.7890123, 7);
    expect(out[0].lon).toBeCloseTo(151.1234567, 7);
    expect(out[0].alt).toBeCloseTo(905.123, 3);
  });
});
