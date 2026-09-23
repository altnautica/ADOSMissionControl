/**
 * ArduPilot DataFlash format characters → JS reader functions.
 *
 * Each FMT message declares a struct with a `format` string of one
 * character per field.
 *
 * | char | width | type                                              |
 * |------|-------|---------------------------------------------------|
 * | `b`  | 1     | int8                                              |
 * | `B`  | 1     | uint8                                             |
 * | `h`  | 2     | int16                                             |
 * | `H`  | 2     | uint16                                            |
 * | `i`  | 4     | int32                                             |
 * | `I`  | 4     | uint32                                            |
 * | `f`  | 4     | float32                                           |
 * | `g`  | 2     | float16 (IEEE 754 half precision)                 |
 * | `d`  | 8     | float64                                           |
 * | `n`  | 4     | char[4] (zero-terminated string)                  |
 * | `N`  | 16    | char[16] (zero-terminated string)                 |
 * | `Z`  | 64    | char[64] (zero-terminated string)                 |
 * | `c`  | 2     | int16 × 100 (scaled — value × 100)                |
 * | `C`  | 2     | uint16 × 100                                      |
 * | `e`  | 4     | int32 × 100                                       |
 * | `E`  | 4     | uint32 × 100                                      |
 * | `L`  | 4     | int32 × 1e7 (lat/lon)                             |
 * | `M`  | 1     | uint8 (flight mode enum)                          |
 * | `q`  | 8     | int64                                             |
 * | `Q`  | 8     | uint64                                            |
 * | `a`  | 64    | int16[32] (vector — 32 int16s)                    |
 *
 * @module dataflash/format-types
 * @license GPL-3.0-only
 */

/** Read a single field at byte offset `ofs` from `view`. Returns the parsed value. */
export type FieldReader = (view: DataView, ofs: number) => number | string | number[];

/** Width in bytes for a single occurrence of the format character. */
export interface FormatChar {
  width: number;
  read: FieldReader;
}

const decoder = new TextDecoder("ascii", { fatal: false });

function readZeroTerminatedString(view: DataView, ofs: number, length: number): string {
  const bytes = new Uint8Array(view.buffer, view.byteOffset + ofs, length);
  // Trim at the first NUL.
  let end = bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0) {
      end = i;
      break;
    }
  }
  return decoder.decode(bytes.subarray(0, end));
}

/** Decode an IEEE 754 half-precision value (1 sign, 5 exponent, 10 fraction bits). */
function readFloat16(view: DataView, ofs: number): number {
  const bits = view.getUint16(ofs, true);
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x3ff;
  if (exponent === 0) return sign * fraction * 2 ** -24;
  if (exponent === 0x1f) return fraction ? Number.NaN : sign * Infinity;
  return sign * (1 + fraction / 1024) * 2 ** (exponent - 15);
}

export const FORMAT_CHARS: Record<string, FormatChar> = {
  b: { width: 1, read: (v, o) => v.getInt8(o) },
  B: { width: 1, read: (v, o) => v.getUint8(o) },
  h: { width: 2, read: (v, o) => v.getInt16(o, true) },
  H: { width: 2, read: (v, o) => v.getUint16(o, true) },
  i: { width: 4, read: (v, o) => v.getInt32(o, true) },
  I: { width: 4, read: (v, o) => v.getUint32(o, true) },
  f: { width: 4, read: (v, o) => v.getFloat32(o, true) },
  d: { width: 8, read: (v, o) => v.getFloat64(o, true) },
  g: { width: 2, read: readFloat16 },
  n: { width: 4, read: (v, o) => readZeroTerminatedString(v, o, 4) },
  N: { width: 16, read: (v, o) => readZeroTerminatedString(v, o, 16) },
  Z: { width: 64, read: (v, o) => readZeroTerminatedString(v, o, 64) },
  c: { width: 2, read: (v, o) => v.getInt16(o, true) / 100 },
  C: { width: 2, read: (v, o) => v.getUint16(o, true) / 100 },
  e: { width: 4, read: (v, o) => v.getInt32(o, true) / 100 },
  E: { width: 4, read: (v, o) => v.getUint32(o, true) / 100 },
  L: { width: 4, read: (v, o) => v.getInt32(o, true) / 1e7 },
  M: { width: 1, read: (v, o) => v.getUint8(o) },
  q: {
    width: 8,
    read: (v, o) => {
      // BigInt → number; ArduPilot timestamps fit in safe-integer range for any reasonable flight.
      const lo = v.getUint32(o, true);
      const hi = v.getInt32(o + 4, true);
      return hi * 0x1_0000_0000 + lo;
    },
  },
  Q: {
    width: 8,
    read: (v, o) => {
      const lo = v.getUint32(o, true);
      const hi = v.getUint32(o + 4, true);
      return hi * 0x1_0000_0000 + lo;
    },
  },
  a: {
    width: 64,
    read: (v, o) => {
      const out: number[] = new Array(32);
      for (let i = 0; i < 32; i++) out[i] = v.getInt16(o + i * 2, true);
      return out;
    },
  },
};

/**
 * Sum of widths of all fields in a format string, or `undefined` when it holds
 * a character this reader has no decoder for.
 */
export function formatStringWidth(format: string): number | undefined {
  let total = 0;
  for (const ch of format) {
    const def = FORMAT_CHARS[ch];
    if (!def) return undefined;
    total += def.width;
  }
  return total;
}
