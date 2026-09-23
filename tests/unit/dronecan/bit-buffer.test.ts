/**
 * @license GPL-3.0-only
 *
 * The expected bytes are reference DroneCAN encodings of each field sequence:
 * every scalar is its little-endian byte image with the final partial byte
 * trimmed to its low bits, copied into the stream most significant bit first.
 * Every sequence is checked in both directions against the same bytes, so a
 * writer and reader that agree with each other but not with the wire fail.
 */

import { describe, expect, it } from "vitest";
import {
  BitReader,
  BitWriter,
  decodeFloat16,
  encodeFloat16,
} from "@/lib/dronecan/bit-buffer";

type Field =
  | { kind: "int"; value: number; bits: number; signed?: boolean }
  | { kind: "big"; value: bigint; bits: number; signed?: boolean }
  | { kind: "f16"; value: number }
  | { kind: "f32"; value: number };

interface Vector {
  name: string;
  fields: Field[];
  bytes: number[];
}

const VECTORS: Vector[] = [
  {
    name: "uint3 then uint5 fill one byte from the top",
    fields: [
      { kind: "int", value: 7, bits: 3 },
      { kind: "int", value: 5, bits: 5 },
    ],
    bytes: [0xe5],
  },
  {
    name: "int27 at bit offset 1, minimum",
    fields: [
      { kind: "int", value: 0, bits: 1 },
      { kind: "int", value: -(1 << 26), bits: 27, signed: true },
    ],
    bytes: [0x00, 0x00, 0x00, 0x40],
  },
  {
    name: "int27 at bit offset 1, maximum",
    fields: [
      { kind: "int", value: 0, bits: 1 },
      { kind: "int", value: (1 << 26) - 1, bits: 27, signed: true },
    ],
    bytes: [0x7f, 0xff, 0xff, 0xb0],
  },
  {
    name: "int37 minimum then maximum",
    fields: [
      { kind: "big", value: -(BigInt(1) << BigInt(36)), bits: 37, signed: true },
      { kind: "big", value: (BigInt(1) << BigInt(36)) - BigInt(1), bits: 37, signed: true },
    ],
    bytes: [0x00, 0x00, 0x00, 0x00, 0x87, 0xff, 0xff, 0xff, 0xfb, 0xc0],
  },
  {
    name: "uint32 at bit offset 3",
    fields: [
      { kind: "int", value: 0, bits: 3 },
      { kind: "int", value: 0xdeadbeef, bits: 32 },
      { kind: "int", value: 0, bits: 5 },
    ],
    bytes: [0x1d, 0xf7, 0xd5, 0xbb, 0xc0],
  },
  {
    name: "int64 at bit offset 3",
    fields: [
      { kind: "int", value: 0, bits: 3 },
      { kind: "big", value: BigInt(-2), bits: 64, signed: true },
      { kind: "int", value: 0, bits: 5 },
    ],
    bytes: [0x1f, 0xdf, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xe0],
  },
  {
    name: "float32 at bit offset 5",
    fields: [
      { kind: "int", value: 0, bits: 5 },
      { kind: "f32", value: -2.5 },
      { kind: "int", value: 5, bits: 3 },
    ],
    bytes: [0x00, 0x00, 0x01, 0x06, 0x05],
  },
  {
    name: "mixed widths, unaligned throughout",
    fields: [
      { kind: "int", value: 1, bits: 1 },
      { kind: "int", value: 0xab, bits: 8 },
      { kind: "int", value: 0x123, bits: 12 },
      { kind: "big", value: BigInt("0x123456789ABCDEF"), bits: 60 },
      { kind: "f16", value: 1.5 },
      { kind: "int", value: -3, bits: 6, signed: true },
    ],
    bytes: [0xd5, 0x91, 0x8f, 0x7e, 0x6d, 0x5c, 0x4b, 0x3a, 0x29, 0x18, 0x80, 0x1f, 0x7a],
  },
];

describe("BitWriter matches the DroneCAN scalar layout", () => {
  for (const v of VECTORS) {
    it(v.name, () => {
      const w = new BitWriter();
      for (const f of v.fields) {
        if (f.kind === "int") w.write(f.value, f.bits);
        else if (f.kind === "big") w.writeBig(f.value, f.bits);
        else if (f.kind === "f16") w.writeFloat16(f.value);
        else w.writeFloat32(f.value);
      }
      expect(Array.from(w.toUint8Array())).toEqual(v.bytes);
    });
  }
});

describe("BitReader matches the DroneCAN scalar layout", () => {
  for (const v of VECTORS) {
    it(v.name, () => {
      const r = new BitReader(new Uint8Array(v.bytes));
      for (const f of v.fields) {
        if (f.kind === "int") expect(r.read(f.bits, f.signed)).toBe(f.value);
        else if (f.kind === "big") expect(r.readBig(f.bits, f.signed)).toBe(f.value);
        else if (f.kind === "f16") expect(r.readFloat16()).toBe(f.value);
        else expect(r.readFloat32()).toBe(f.value);
      }
    });
  }

  it("refuses to read past the end of the buffer", () => {
    const r = new BitReader(new Uint8Array([0xff]));
    r.read(3);
    expect(() => r.read(6)).toThrow(RangeError);
    expect(() => r.readBig(6)).toThrow(RangeError);
  });
});

describe("float16 special cases", () => {
  it("round-trips 0.0, -0.0, ±Inf, NaN, ±1.0, max normal, denormal", () => {
    const zero = decodeFloat16(encodeFloat16(0));
    expect(Object.is(zero, 0)).toBe(true);

    const negZero = decodeFloat16(encodeFloat16(-0));
    expect(Object.is(negZero, -0)).toBe(true);

    expect(decodeFloat16(encodeFloat16(Infinity))).toBe(Infinity);
    expect(decodeFloat16(encodeFloat16(-Infinity))).toBe(-Infinity);
    expect(Number.isNaN(decodeFloat16(encodeFloat16(NaN)))).toBe(true);

    expect(decodeFloat16(encodeFloat16(1))).toBe(1);
    expect(decodeFloat16(encodeFloat16(-1))).toBe(-1);
    expect(decodeFloat16(encodeFloat16(65504))).toBe(65504);

    // Smallest positive denormal: 2^-24.
    const denormal = Math.pow(2, -24);
    expect(decodeFloat16(encodeFloat16(denormal))).toBeCloseTo(denormal, 8);
  });

  it("encodes overflow to ±Inf", () => {
    expect(decodeFloat16(encodeFloat16(70000))).toBe(Infinity);
    expect(decodeFloat16(encodeFloat16(-70000))).toBe(-Infinity);
  });
});
