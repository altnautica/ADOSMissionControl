/**
 * @license GPL-3.0-only
 *
 * The msgpack reader, checked against frames the Drone Agent's own producer
 * emitted. The two assertions that matter most are shape assertions, because
 * both were guessed wrong before the golden frames were captured: struct fields
 * are `snake_case` string keys with `Option::None` present as nil, and an
 * `AtlasEvent` payload (`Vec<u8>`) is an ARRAY of integers rather than a `bin`
 * payload.
 */

import { describe, it, expect } from "vitest";

import { asMsgpackMap, decodeMsgpack, MsgpackError } from "../msgpack";
import {
  GOLDEN_EVENT_HEX,
  GOLDEN_SPLAT_HEX,
  hexBytes,
} from "./golden-atlas-frames";

describe("decodeMsgpack against producer frames", () => {
  it("reads a splat descriptor as a snake_case map with nil for an absent Option", () => {
    const map = asMsgpackMap(decodeMsgpack(hexBytes(GOLDEN_SPLAT_HEX)));
    expect(map).not.toBeNull();
    expect(map?.session_id).toBe("atlas-drone-1-1000");
    expect(map?.generation).toBe(7);
    expect(map?.gaussian_count).toBe(1_250_000);
    expect(map?.step).toBe(30_000);
    expect(map?.lod_levels).toBe(4);
    // `handle: None` with no `skip_serializing_if` — the KEY is present and
    // carries nil, so a reader must not treat presence as a value.
    expect("handle" in (map ?? {})).toBe(true);
    expect(map?.handle).toBeNull();
    expect(map?.manifest_url).toBe(
      "http://192.168.1.50:8092/artifacts/job-1/manifest.json",
    );
  });

  it("reads an event payload as an array of byte integers, not a bin blob", () => {
    const map = asMsgpackMap(decodeMsgpack(hexBytes(GOLDEN_EVENT_HEX)));
    const payload = map?.payload;
    expect(Array.isArray(payload)).toBe(true);
    expect((payload as unknown[]).length).toBe(216);
    // Every element is a plain integer in byte range; a `bin` reader would have
    // produced a Uint8Array and a `bin`-only decoder would have thrown.
    expect(payload).not.toBeInstanceOf(Uint8Array);
    expect(
      (payload as number[]).every(
        (b) => Number.isInteger(b) && b >= 0 && b <= 255,
      ),
    ).toBe(true);
  });

  it("decodes float32 and float64 at their own precision", () => {
    // 0.2 as float32 is not 0.2 as float64; the reader must not widen it wrong.
    const f32 = decodeMsgpack(hexBytes("ca3e4ccccd")) as number;
    expect(f32).toBeCloseTo(0.2, 6);
    expect(decodeMsgpack(hexBytes("cb403f400000000000"))).toBe(31.25);
  });
});

describe("decodeMsgpack refusals", () => {
  it("rejects a truncated frame instead of returning a partial value", () => {
    // fixmap(1) with a key and no value.
    expect(() => decodeMsgpack(hexBytes("81a16b"))).toThrow(MsgpackError);
  });

  it("rejects trailing bytes so a concatenated stream is not half-read", () => {
    expect(() => decodeMsgpack(hexBytes("0102"))).toThrow(/trailing bytes/);
  });

  it("rejects an out-of-contract tag rather than inventing a reading", () => {
    // 0xc7 is ext8 — the atlas contract emits no ext types.
    expect(() => decodeMsgpack(hexBytes("c70100ff"))).toThrow(
      /unsupported msgpack tag 0xc7/,
    );
  });

  it("rejects a non-string map key", () => {
    // fixmap(1) { 1: nil } — not the string-keyed struct shape.
    expect(() => decodeMsgpack(hexBytes("8101c0"))).toThrow(
      /map key must be a string/,
    );
  });
});

describe("64-bit integers", () => {
  it("keeps a value past MAX_SAFE_INTEGER as bigint rather than rounding", () => {
    // uint64 2^53 + 1 — the first integer a double cannot represent.
    const v = decodeMsgpack(hexBytes("cf0020000000000001"));
    expect(typeof v).toBe("bigint");
    expect(v).toBe(9007199254740993n);
  });

  it("narrows a representable 64-bit value to a number", () => {
    expect(decodeMsgpack(hexBytes("cf0000000000000007"))).toBe(7);
  });
});

describe("asMsgpackMap", () => {
  it("refuses an array, a scalar, and a binary payload", () => {
    expect(asMsgpackMap(decodeMsgpack(hexBytes("9101")))).toBeNull();
    expect(asMsgpackMap(decodeMsgpack(hexBytes("07")))).toBeNull();
    expect(asMsgpackMap(decodeMsgpack(hexBytes("c401ff")))).toBeNull();
  });
});
