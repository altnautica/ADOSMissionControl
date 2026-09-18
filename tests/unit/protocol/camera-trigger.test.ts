/**
 * CAMERA_TRIGGER (112) carries no position.
 *
 * The canonical message is exactly `uint64 time_usec` + `uint32 seq`, LEN 12.
 * The repo registered `PAYLOAD_LENGTHS[112] = 24` and read lat/lon/alt at
 * offsets 12/16/20. The parser's zero-restore padded the wire payload out to
 * 24 bytes, so those reads silently returned 0 — and `handleCameraTrigger`
 * pushed `lat: 0, lon: 0` into a ring buffer AND into the persisted flight
 * record. Every triggered photo was stamped 0°N 0°E, which is a real place in
 * the Gulf of Guinea, not an obvious sentinel.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { decodeCameraTrigger } from "@/lib/protocol/messages/peripheral";
import { PAYLOAD_LENGTHS } from "@/lib/protocol/mavlink-crc-extra";

/** A canonical 12-byte CAMERA_TRIGGER payload. */
function payload(timeUsec: bigint, seq: number): DataView {
  const buf = new ArrayBuffer(12);
  const dv = new DataView(buf);
  dv.setUint32(0, Number(timeUsec & 0xffffffffn), true);
  dv.setUint32(4, Number(timeUsec >> 32n), true);
  dv.setUint32(8, seq, true);
  return dv;
}

describe("CAMERA_TRIGGER", () => {
  it("is declared as 12 bytes, the canonical length", () => {
    // 24 was the invented length that made room for three fields the
    // message does not have.
    expect(PAYLOAD_LENGTHS.get(112)).toBe(12);
  });

  it("decodes only the two fields the message actually carries", () => {
    const decoded = decodeCameraTrigger(payload(1_234_567_890n, 42));
    expect(decoded.timeUsec).toBe(1_234_567_890);
    expect(decoded.seq).toBe(42);
    // No fabricated position. A `lat`/`lon` here is a coordinate nobody
    // measured, written to the persisted flight record.
    expect(Object.keys(decoded).sort()).toEqual(["seq", "timeUsec"]);
  });

  it("does not invent a position from a padded payload", () => {
    // The parser zero-restores a short payload, which is exactly how the
    // invented reads returned 0 rather than throwing.
    const padded = new DataView(new ArrayBuffer(24));
    padded.setUint32(0, 7, true);
    padded.setUint32(8, 3, true);
    const decoded = decodeCameraTrigger(padded);
    expect("lat" in decoded).toBe(false);
    expect("lon" in decoded).toBe(false);
    expect("alt" in decoded).toBe(false);
  });
});
