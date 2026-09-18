/**
 * @module param-getset
 * @description Codec for `uavcan.protocol.param.GetSet` (service type id 11).
 *
 * This is a BIT-PACKED structure, not a byte-aligned one, and it was previously
 * encoded and decoded one byte off:
 *
 *  - The request's `index` is `uint13`, not `uint16`, and the `Value` union tag
 *    is **3 bits**, not a whole byte. 13 + 3 = 16, so the union payload starts
 *    at byte 2 — but only if the tag occupies the top three bits of byte 1.
 *    Writing the index as a full 16 bits and the tag as a byte at offset 2 made
 *    a receiver read `tag = (byte1 >> 5) & 7 = 0` (Empty) and take the rest as
 *    the TAO `name` tail-array, so `paramGet(node, i)` sent a non-empty name
 *    `"\0"` — and DSDL says name is "always preferred over index if nonempty",
 *    so the node answered with an empty response for every index.
 *  - `max_value` and `min_value` are `NumericValue`, a THREE-member union whose
 *    tag is **2 bits**. Decoding them with the 3-bit `Value` tag (previously a
 *    whole byte) desynchronises the rest of the response.
 *
 * Request layout (bit stream, LSB-first within each byte per DroneCAN):
 *   uint13         index
 *   Value          value        (3-bit tag + payload)
 *   uint8[<=92]    name         (tail-array, no length prefix — last field)
 *
 * Response layout:
 *   Value          value              (3-bit tag)
 *   Value          default_value      (3-bit tag)
 *   NumericValue   max_value          (2-bit tag)
 *   NumericValue   min_value          (2-bit tag)
 *   uint8[<=92]    name               (tail-array)
 *
 * `Value` union (5 members → 3-bit tag):
 *   0 Empty      (0 bits)
 *   1 Integer    int64
 *   2 Real       float32
 *   3 Boolean    uint8
 *   4 String     uint8[<=128]  (tail-array within the enclosing structure)
 *
 * `NumericValue` union (3 members → 2-bit tag):
 *   0 Empty      (0 bits)
 *   1 Integer    int64
 *   2 Real       float32
 *
 * Bit packing goes through the repo's shared {@link BitWriter}/{@link BitReader},
 * the same helpers every other bit-packed DSDL codec here uses, so the bit order
 * convention is stated in exactly one place.
 * @license GPL-3.0-only
 */

import { BitReader, BitWriter } from "../bit-buffer";

export enum ValueTag {
  Empty = 0,
  Integer = 1,
  Real = 2,
  Boolean = 3,
  String = 4,
}

/** Width of the `Value` union tag: 5 members → ceil(log2(5)) = 3 bits. */
const VALUE_TAG_BITS = 3;

/**
 * Width of the `NumericValue` union tag: 3 members → ceil(log2(3)) = 2 bits.
 * `max_value` and `min_value` are NumericValue, NOT Value.
 */
const NUMERIC_VALUE_TAG_BITS = 2;

/** DSDL caps `GetSet.name` at 92 bytes and `Value.string_value` at 128. */
const NAME_MAX_BYTES = 92;
const STRING_VALUE_MAX_BYTES = 128;

export type Value =
  | { tag: ValueTag.Empty }
  | { tag: ValueTag.Integer; value: bigint }
  | { tag: ValueTag.Real; value: number }
  | { tag: ValueTag.Boolean; value: boolean }
  | { tag: ValueTag.String; value: string };

export interface ParamGetSetRequest {
  index: number;
  value: Value;
  name: string;
}

export interface ParamGetSetResponse {
  value: Value;
  default_value: Value;
  max_value: Value;
  min_value: Value;
  name: string;
}

/**
 * Write a union tag plus its payload. `tagBits` selects the union: 3 for
 * `Value`, 2 for `NumericValue` (which has no Boolean or String member, so
 * those tags cannot be represented there).
 */
function writeValue(w: BitWriter, value: Value, tagBits: number): void {
  if (
    tagBits === NUMERIC_VALUE_TAG_BITS &&
    value.tag !== ValueTag.Empty &&
    value.tag !== ValueTag.Integer &&
    value.tag !== ValueTag.Real
  ) {
    throw new Error(
      `NumericValue cannot carry tag ${value.tag}: only Empty, Integer and Real exist`,
    );
  }
  w.write(value.tag, tagBits);
  switch (value.tag) {
    case ValueTag.Empty:
      return;
    case ValueTag.Integer:
      w.writeBig(value.value, 64);
      return;
    case ValueTag.Real:
      w.writeFloat32(value.value);
      return;
    case ValueTag.Boolean:
      w.write(value.value ? 1 : 0, 8);
      return;
    case ValueTag.String: {
      const bytes = new TextEncoder().encode(value.value);
      if (bytes.length > STRING_VALUE_MAX_BYTES) {
        throw new Error(
          `Value.String must be <= ${STRING_VALUE_MAX_BYTES} bytes`,
        );
      }
      // Tail-array optimised: no length prefix, and it consumes the rest of
      // the structure. Written bit-wise because the stream may be unaligned.
      for (const b of bytes) w.write(b, 8);
      return;
    }
  }
}

/**
 * Read a union tag plus its payload at the reader's current bit offset.
 * Returns `null` when the stream has too few bits left for the declared
 * payload, so a truncated frame is reported rather than silently producing a
 * zero-filled value.
 */
function readValue(r: BitReader, tagBits: number): Value | null {
  if (r.remaining() < tagBits) return null;
  const tag = r.read(tagBits) as ValueTag;
  switch (tag) {
    case ValueTag.Empty:
      return { tag: ValueTag.Empty };
    case ValueTag.Integer:
      if (r.remaining() < 64) return null;
      return { tag: ValueTag.Integer, value: r.readBig(64, true) };
    case ValueTag.Real:
      if (r.remaining() < 32) return null;
      return { tag: ValueTag.Real, value: r.readFloat32() };
    case ValueTag.Boolean:
      if (r.remaining() < 8) return null;
      return { tag: ValueTag.Boolean, value: r.read(8) !== 0 };
    case ValueTag.String: {
      // Tail array: consumes every remaining whole byte.
      return { tag: ValueTag.String, value: readTailString(r) };
    }
    default:
      // A tag outside the union is a malformed frame, not an Empty value.
      return null;
  }
}

/** Read the remaining whole bytes of the stream as a UTF-8 string. */
function readTailString(r: BitReader): string {
  const count = Math.floor(r.remaining() / 8);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = r.read(8);
  return new TextDecoder().decode(out);
}

export function encodeParamGetSetRequest(req: ParamGetSetRequest): Uint8Array {
  const nameBytes = new TextEncoder().encode(req.name);
  if (nameBytes.length > NAME_MAX_BYTES) {
    throw new Error(
      `ParamGetSetRequest.name must be <= ${NAME_MAX_BYTES} bytes`,
    );
  }
  if (!Number.isInteger(req.index) || req.index < 0 || req.index > 0x1fff) {
    throw new RangeError(
      `ParamGetSetRequest.index must be a uint13 (0..8191), got ${req.index}`,
    );
  }

  const w = new BitWriter();
  w.write(req.index, 13);
  writeValue(w, req.value, VALUE_TAG_BITS);
  // 13 + 3 = 16 bits, and every Value payload is a whole number of bytes, so
  // the name tail-array always starts byte aligned on the request side.
  for (const b of nameBytes) w.write(b, 8);
  return w.toUint8Array();
}

export function decodeParamGetSetRequest(buf: Uint8Array): ParamGetSetRequest {
  if (buf.length < 2) {
    throw new Error(`ParamGetSetRequest payload too short: ${buf.length}`);
  }
  const r = new BitReader(buf);
  const index = r.read(13);
  const value = readValue(r, VALUE_TAG_BITS);
  if (value === null) {
    throw new Error("ParamGetSetRequest: truncated Value field");
  }
  const name =
    value.tag === ValueTag.String ? "" : readTailString(r);
  return { index, value, name };
}

export function encodeParamGetSetResponse(
  res: ParamGetSetResponse,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(res.name);
  if (nameBytes.length > NAME_MAX_BYTES) {
    throw new Error(
      `ParamGetSetResponse.name must be <= ${NAME_MAX_BYTES} bytes`,
    );
  }
  const w = new BitWriter();
  writeValue(w, res.value, VALUE_TAG_BITS);
  writeValue(w, res.default_value, VALUE_TAG_BITS);
  writeValue(w, res.max_value, NUMERIC_VALUE_TAG_BITS);
  writeValue(w, res.min_value, NUMERIC_VALUE_TAG_BITS);
  for (const b of nameBytes) w.write(b, 8);
  return w.toUint8Array();
}

export function decodeParamGetSetResponse(
  buf: Uint8Array,
): ParamGetSetResponse {
  const r = new BitReader(buf);
  const empty: Value = { tag: ValueTag.Empty };

  const value = readValue(r, VALUE_TAG_BITS);
  if (value === null) {
    throw new Error("ParamGetSetResponse: truncated value field");
  }
  // A String value is tail-array optimised and consumes the rest of the
  // structure, so nothing follows it.
  if (value.tag === ValueTag.String) {
    return {
      value,
      default_value: empty,
      max_value: empty,
      min_value: empty,
      name: "",
    };
  }

  const defaultValue = readValue(r, VALUE_TAG_BITS) ?? empty;
  if (defaultValue.tag === ValueTag.String) {
    return {
      value,
      default_value: defaultValue,
      max_value: empty,
      min_value: empty,
      name: "",
    };
  }

  const maxValue = readValue(r, NUMERIC_VALUE_TAG_BITS) ?? empty;
  const minValue = readValue(r, NUMERIC_VALUE_TAG_BITS) ?? empty;
  const name = readTailString(r);

  return {
    value,
    default_value: defaultValue,
    max_value: maxValue,
    min_value: minValue,
    name,
  };
}
