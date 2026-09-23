/**
 * @module bit-buffer
 * @description Bit-stream reader and writer for DroneCAN DSDL payloads.
 *
 * A DroneCAN payload is one bit stream in which stream bit 0 is the most
 * significant bit of byte 0. Fields are packed back to back with no
 * alignment. An N-bit scalar is laid out as the DroneCAN wire format
 * specifies:
 *
 *   1. take the value's little-endian byte image (two's complement for
 *      signed values),
 *   2. keep every whole low byte, and of the final partial byte only its low
 *      N % 8 bits,
 *   3. copy those chunks into the stream in order, each one most significant
 *      bit first.
 *
 * So a byte-aligned uint16 appears as its two little-endian bytes, a uint3
 * followed by a uint5 share one byte top-down (the uint3 in bits 7..5), and an
 * int14 holding 1229 (0x04CD) emits the eight bits of 0xCD followed by the six
 * bits 000100. Decoding reverses the copy and, for signed fields,
 * sign-extends from bit N-1.
 *
 * `float16` is IEEE 754 half precision: 1 sign bit, 5 exponent bits, 10
 * mantissa bits. The encoder/decoder handles ±0, ±Inf, NaN, denormals, and
 * the normal range.
 *
 * `read` and `write` cap at 32 bits per call so the arithmetic stays in plain
 * numbers. Wider fields use `readBig` / `writeBig`, which operate on `bigint`.
 *
 * @license GPL-3.0-only
 */

/**
 * Sequential reader over a `Uint8Array`. Tracks a bit offset and pulls
 * arbitrary bit-width fields from the underlying byte buffer.
 */
export class BitReader {
  private readonly buf: Uint8Array;
  private bitOffset = 0;
  private readonly totalBits: number;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.totalBits = buf.length * 8;
  }

  /** Bits remaining until the end of the buffer. */
  remaining(): number {
    return this.totalBits - this.bitOffset;
  }

  /** Skip `bits` bits forward without producing a value. */
  skip(bits: number): void {
    if (bits < 0) throw new RangeError("skip: bits must be non-negative");
    if (this.bitOffset + bits > this.totalBits) {
      throw new RangeError("skip: past end of buffer");
    }
    this.bitOffset += bits;
  }

  /**
   * Read up to 32 bits. Throws if `bits` exceeds 32; use `readBig` for wider
   * fields. When `signed` is true the value is sign-extended assuming two's
   * complement.
   */
  read(bits: number, signed = false): number {
    if (bits < 0 || bits > 32) {
      throw new RangeError("read: bits must be 0..32; use readBig for >32");
    }
    if (bits === 0) return 0;
    if (this.bitOffset + bits > this.totalBits) {
      throw new RangeError("read: past end of buffer");
    }
    let value = 0;
    let scale = 1;
    for (let left = bits; left > 0; left -= 8) {
      value += this.readChunk(left < 8 ? left : 8) * scale;
      scale *= 256;
    }
    if (signed && value >= 2 ** (bits - 1)) value -= 2 ** bits;
    return value;
  }

  /** Read an arbitrary-width field as a `bigint`. */
  readBig(bits: number, signed = false): bigint {
    if (bits < 0) throw new RangeError("readBig: bits must be non-negative");
    if (bits === 0) return 0n;
    if (this.bitOffset + bits > this.totalBits) {
      throw new RangeError("readBig: past end of buffer");
    }
    let value = 0n;
    let shift = 0n;
    for (let left = bits; left > 0; left -= 8) {
      value |= BigInt(this.readChunk(left < 8 ? left : 8)) << shift;
      shift += 8n;
    }
    return signed ? BigInt.asIntN(bits, value) : value;
  }

  /** Read an IEEE 754 half-precision float (16 bits). */
  readFloat16(): number {
    return decodeFloat16(this.read(16));
  }

  /** Read an IEEE 754 single-precision float (32 bits). */
  readFloat32(): number {
    F32_U32[0] = this.read(32);
    return F32_F32[0] ?? 0;
  }

  /**
   * Read `n` whole bytes. Requires the current bit offset to be byte aligned.
   * Returns a defensive copy.
   */
  readBytes(n: number): Uint8Array {
    if (this.bitOffset % 8 !== 0) {
      throw new Error("readBytes: stream is not byte aligned");
    }
    const start = this.bitOffset / 8;
    if (start + n > this.buf.length) {
      throw new RangeError("readBytes: past end of buffer");
    }
    const out = new Uint8Array(this.buf.subarray(start, start + n));
    this.bitOffset += n * 8;
    return out;
  }

  /** Force the cursor to the next byte boundary if it is not already. */
  alignToByte(): void {
    const slack = this.bitOffset % 8;
    if (slack !== 0) this.bitOffset += 8 - slack;
  }

  /** Current bit offset, useful for diagnostics and tests. */
  position(): number {
    return this.bitOffset;
  }

  /** Pull `n` (1..8) bits off the stream, most significant bit first. */
  private readChunk(n: number): number {
    let out = 0;
    let left = n;
    while (left > 0) {
      const avail = 8 - (this.bitOffset & 7);
      const take = left < avail ? left : avail;
      const byte = this.buf[this.bitOffset >>> 3];
      out = (out << take) | ((byte >>> (avail - take)) & ((1 << take) - 1));
      this.bitOffset += take;
      left -= take;
    }
    return out;
  }
}

/**
 * Sequential writer that grows a byte buffer as fields are pushed, using the
 * same bit layout {@link BitReader} reads. `toUint8Array` returns the payload
 * zero-padded to a whole byte.
 */
export class BitWriter {
  private bytes: number[] = [];
  private bitOffset = 0;

  /** Total bits emitted so far. */
  bitsWritten(): number {
    return this.bitOffset;
  }

  /** Write the low `bits` (0..32) bits of an unsigned or signed integer. */
  write(value: number, bits: number): void {
    if (bits < 0 || bits > 32) {
      throw new RangeError("write: bits must be 0..32; use writeBig for >32");
    }
    if (bits === 0) return;
    // Two's complement image of the low `bits` bits.
    const image = value >>> 0;
    let u = bits === 32 ? image : image & (2 ** bits - 1);
    for (let left = bits; left > 0; left -= 8) {
      this.writeChunk(u & 0xff, left < 8 ? left : 8);
      u >>>= 8;
    }
  }

  /** Write the low `bits` bits of an arbitrary-width integer. */
  writeBig(value: bigint, bits: number): void {
    if (bits < 0) throw new RangeError("writeBig: bits must be non-negative");
    if (bits === 0) return;
    let u = BigInt.asUintN(bits, value);
    for (let left = bits; left > 0; left -= 8) {
      this.writeChunk(Number(u & 0xffn), left < 8 ? left : 8);
      u >>= 8n;
    }
  }

  /** Write an IEEE 754 half-precision float (16 bits). */
  writeFloat16(v: number): void {
    this.write(encodeFloat16(v), 16);
  }

  /** Write an IEEE 754 single-precision float (32 bits). */
  writeFloat32(v: number): void {
    F32_F32[0] = v;
    this.write(F32_U32[0] ?? 0, 32);
  }

  /**
   * Write `buf` as raw bytes. Requires the current bit offset to be byte
   * aligned.
   */
  writeBytes(buf: Uint8Array): void {
    if (this.bitOffset % 8 !== 0) {
      throw new Error("writeBytes: stream is not byte aligned");
    }
    for (let i = 0; i < buf.length; i++) {
      this.bytes.push(buf[i] ?? 0);
      this.bitOffset += 8;
    }
  }

  /** Pad to the next byte boundary with zero bits. */
  alignToByte(): void {
    const slack = this.bitOffset % 8;
    if (slack !== 0) {
      this.write(0, 8 - slack);
    }
  }

  /** Finalize and return the byte buffer (zero-padded at the tail). */
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  /** Push the low `n` (1..8) bits of `value`, most significant bit first. */
  private writeChunk(value: number, n: number): void {
    let left = n;
    while (left > 0) {
      const avail = 8 - (this.bitOffset & 7);
      const take = left < avail ? left : avail;
      const slice = (value >>> (left - take)) & ((1 << take) - 1);
      const index = this.bitOffset >>> 3;
      if (index === this.bytes.length) this.bytes.push(0);
      this.bytes[index] |= slice << (avail - take);
      this.bitOffset += take;
      left -= take;
    }
  }
}

// ── float16 (IEEE 754 half-precision) ────────────────────────────

const F16_SCRATCH_BUF = new ArrayBuffer(4);
const F16_F32 = new Float32Array(F16_SCRATCH_BUF);
const F16_U32 = new Uint32Array(F16_SCRATCH_BUF);

const F32_SCRATCH_BUF = new ArrayBuffer(4);
const F32_F32 = new Float32Array(F32_SCRATCH_BUF);
const F32_U32 = new Uint32Array(F32_SCRATCH_BUF);

/** Encode a JS number into the 16-bit IEEE 754 half representation. */
export function encodeFloat16(v: number): number {
  F16_F32[0] = v;
  const x = F16_U32[0] ?? 0;
  const sign = (x >>> 16) & 0x8000;
  const exp32 = (x >>> 23) & 0xff;
  const frac = x & 0x7fffff;

  if (exp32 === 0xff) {
    // Inf or NaN. Preserve NaN payload bit so it stays NaN.
    if (frac !== 0) return sign | 0x7e00;
    return sign | 0x7c00;
  }

  // Unbias from float32 (127) and rebias for float16 (15).
  const exp16 = exp32 - 127 + 15;
  if (exp16 >= 0x1f) {
    // Overflow to ±Inf.
    return sign | 0x7c00;
  }
  if (exp16 <= 0) {
    // Underflow: produce a denormal or zero.
    if (exp16 < -10) return sign;
    const mant = frac | 0x800000;
    const shift = 14 - exp16;
    const denorm = (mant >> shift) & 0x3ff;
    // Round-to-nearest-even on the bit shifted out.
    const round = (mant >> (shift - 1)) & 1;
    return sign | (denorm + round);
  }
  // Normal number. Truncate the 23-bit mantissa to 10 bits and round half-up.
  const mant10 = frac >> 13;
  const roundBit = (frac >> 12) & 1;
  return sign | (exp16 << 10) | (mant10 + roundBit);
}

/** Decode a 16-bit IEEE 754 half representation to a JS number. */
export function decodeFloat16(raw: number): number {
  const r = raw & 0xffff;
  const sign = (r & 0x8000) >>> 15;
  const exp = (r & 0x7c00) >>> 10;
  const frac = r & 0x3ff;
  const signMul = sign ? -1 : 1;

  if (exp === 0) {
    if (frac === 0) return signMul * 0;
    // Denormal: value = sign * 2^-14 * (frac / 1024).
    return signMul * Math.pow(2, -14) * (frac / 1024);
  }
  if (exp === 0x1f) {
    if (frac === 0) return signMul * Infinity;
    return NaN;
  }
  // Normal: value = sign * 2^(exp - 15) * (1 + frac / 1024).
  return signMul * Math.pow(2, exp - 15) * (1 + frac / 1024);
}

/** Helper: encode a single `Uint8Array` via a `BitWriter` callback. */
export function withBitWriter(fn: (w: BitWriter) => void): Uint8Array {
  const w = new BitWriter();
  fn(w);
  return w.toUint8Array();
}

/** Helper: build a `BitReader` from a `Uint8Array`. */
export function bitReader(buf: Uint8Array): BitReader {
  return new BitReader(buf);
}

// Reset the scratch buffer between calls to keep test output deterministic
// when the module is reloaded by Vitest's module isolation.
F16_U32[0] = 0;
