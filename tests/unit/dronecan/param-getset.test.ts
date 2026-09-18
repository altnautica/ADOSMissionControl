/**
 * @license GPL-3.0-only
 *
 * `uavcan.protocol.param.GetSet` is bit-packed, and the codec was one byte off
 * in both directions. These tests assert the WIRE BYTES against the DSDL
 * definition (`dronecan/DSDL uavcan/protocol/param/11.GetSet.uavcan`) rather
 * than round-tripping the codec against itself, because a symmetric encoder and
 * decoder agree perfectly while both disagree with the flight controller.
 *
 * The concrete defect: `index` is `uint13` and the `Value` union tag is 3 bits,
 * so they share the first two bytes. Writing `index` as a full uint16 and the
 * tag as a whole byte at offset 2 made a real node read tag 0 (Empty) and take
 * the remainder as the tail-array `name` — a non-empty `"\0"` — and DSDL says a
 * non-empty name wins over the index, so every index walk came back empty.
 */

import { describe, expect, it } from "vitest";

import {
  ValueTag,
  decodeParamGetSetRequest,
  decodeParamGetSetResponse,
  encodeParamGetSetRequest,
  encodeParamGetSetResponse,
} from "@/lib/dronecan/dsdl/param-getset";

describe("param.GetSet request wire format", () => {
  it("packs uint13 index and the 3-bit Empty tag into exactly two bytes", () => {
    const bytes = encodeParamGetSetRequest({
      index: 0,
      value: { tag: ValueTag.Empty },
      name: "",
    });
    // 13 bits of index + 3 bits of tag = 16 bits, and Empty has no payload.
    expect(Array.from(bytes)).toEqual([0x00, 0x00]);
  });

  it("keeps the index inside its 13 bits and the tag above them", () => {
    // index 0x1234 & 0x1fff = 0x1234; tag Real = 2 sits in bits 13..15.
    const bytes = encodeParamGetSetRequest({
      index: 0x1234,
      value: { tag: ValueTag.Real, value: 0 },
      name: "",
    });
    expect(bytes[0]).toBe(0x34);
    // Low 5 bits of byte 1 are index bits 8..12; top 3 bits are the tag.
    expect(bytes[1] & 0x1f).toBe(0x12);
    expect((bytes[1] >> 5) & 0x07).toBe(ValueTag.Real);
    // float32 payload follows, then nothing: 2 + 4 bytes.
    expect(bytes.length).toBe(6);
  });

  it("emits a bare index walk with NO name, so the node uses the index", () => {
    const bytes = encodeParamGetSetRequest({
      index: 7,
      value: { tag: ValueTag.Empty },
      name: "",
    });
    // Two bytes only. Any third byte would be a one-character name, and DSDL
    // prefers a non-empty name over the index.
    expect(bytes.length).toBe(2);
    const decoded = decodeParamGetSetRequest(bytes);
    expect(decoded.index).toBe(7);
    expect(decoded.name).toBe("");
    expect(decoded.value.tag).toBe(ValueTag.Empty);
  });

  it("rejects an index outside uint13 instead of silently truncating it", () => {
    expect(() =>
      encodeParamGetSetRequest({
        index: 0x2000,
        value: { tag: ValueTag.Empty },
        name: "",
      }),
    ).toThrow(/uint13/);
  });

  it("round-trips a named integer set request", () => {
    const bytes = encodeParamGetSetRequest({
      index: 0,
      value: { tag: ValueTag.Integer, value: BigInt(-42) },
      name: "UAVCAN_NODE_ID",
    });
    // 2 + 8 (int64) + 14 (name) bytes.
    expect(bytes.length).toBe(2 + 8 + 14);
    const decoded = decodeParamGetSetRequest(bytes);
    expect(decoded.name).toBe("UAVCAN_NODE_ID");
    expect(decoded.value).toEqual({
      tag: ValueTag.Integer,
      value: BigInt(-42),
    });
  });
});

describe("param.GetSet response wire format", () => {
  it("uses a 2-bit tag for the NumericValue min/max fields", () => {
    // value Empty (3 bits) + default Empty (3 bits) + max Empty (2 bits)
    // + min Empty (2 bits) = 10 bits, then the name tail-array.
    const bytes = encodeParamGetSetResponse({
      value: { tag: ValueTag.Empty },
      default_value: { tag: ValueTag.Empty },
      max_value: { tag: ValueTag.Empty },
      min_value: { tag: ValueTag.Empty },
      name: "",
    });
    // 10 bits rounds up to two bytes. A byte-per-tag encoding would emit four.
    expect(bytes.length).toBe(2);
  });

  it("decodes every field of a fully-populated response", () => {
    const encoded = encodeParamGetSetResponse({
      value: { tag: ValueTag.Integer, value: BigInt(5) },
      default_value: { tag: ValueTag.Integer, value: BigInt(3) },
      max_value: { tag: ValueTag.Integer, value: BigInt(127) },
      min_value: { tag: ValueTag.Integer, value: BigInt(0) },
      name: "ESC_INDEX",
    });
    const decoded = decodeParamGetSetResponse(encoded);
    expect(decoded.value).toEqual({ tag: ValueTag.Integer, value: BigInt(5) });
    expect(decoded.default_value).toEqual({
      tag: ValueTag.Integer,
      value: BigInt(3),
    });
    expect(decoded.max_value).toEqual({
      tag: ValueTag.Integer,
      value: BigInt(127),
    });
    expect(decoded.min_value).toEqual({
      tag: ValueTag.Integer,
      value: BigInt(0),
    });
    expect(decoded.name).toBe("ESC_INDEX");
  });

  it("decodes a real-valued response with unaligned following fields", () => {
    // value Real: 3-bit tag + 32 bits = 35 bits, so default_value's tag starts
    // mid-byte. A byte-aligned codec cannot read this at all.
    const encoded = encodeParamGetSetResponse({
      value: { tag: ValueTag.Real, value: 1.5 },
      default_value: { tag: ValueTag.Real, value: 0.25 },
      max_value: { tag: ValueTag.Real, value: 10 },
      min_value: { tag: ValueTag.Real, value: -10 },
      name: "MOT_PWM_MAX",
    });
    const decoded = decodeParamGetSetResponse(encoded);
    expect(decoded.value).toEqual({ tag: ValueTag.Real, value: 1.5 });
    expect(decoded.default_value).toEqual({ tag: ValueTag.Real, value: 0.25 });
    expect(decoded.max_value).toEqual({ tag: ValueTag.Real, value: 10 });
    expect(decoded.min_value).toEqual({ tag: ValueTag.Real, value: -10 });
    expect(decoded.name).toBe("MOT_PWM_MAX");
  });

  it("refuses to encode a Boolean into a NumericValue slot", () => {
    expect(() =>
      encodeParamGetSetResponse({
        value: { tag: ValueTag.Empty },
        default_value: { tag: ValueTag.Empty },
        max_value: { tag: ValueTag.Boolean, value: true },
        min_value: { tag: ValueTag.Empty },
        name: "",
      }),
    ).toThrow(/NumericValue/);
  });
});
