/**
 * @module param-getset
 * @description Codec for `uavcan.protocol.param.GetSet` (service type id 11).
 *
 * This is a bit-packed structure in the DroneCAN scalar layout described in
 * `bit-buffer.ts`.
 *
 * Request layout:
 *   uint13         index
 *   Value          value        (3-bit tag + payload)
 *   uint8[<=92]    name         (tail array, no length prefix — last field)
 *
 * Response layout:
 *   void5
 *   Value          value              (3-bit tag)
 *   void5
 *   Value          default_value      (3-bit tag)
 *   void6
 *   NumericValue   max_value          (2-bit tag)
 *   void6
 *   NumericValue   min_value          (2-bit tag)
 *   uint8[<=92]    name               (tail array)
 *
 * The void padding puts every union tag of the response in the low bits of
 * its own byte, so an integer response for `CAN_NODE = 10` starts `01 0A 00`.
 *
 * `Value` union (5 members → 3-bit tag):
 *   0 Empty      (0 bits)
 *   1 Integer    int64
 *   2 Real       float32
 *   3 Boolean    uint8
 *   4 String     uint8[<=128]  (uint8 length prefix: `Value` is never the
 *                               last field of GetSet, so the tail-array
 *                               optimization never applies to it)
 *
 * `NumericValue` union (3 members → 2-bit tag):
 *   0 Empty      (0 bits)
 *   1 Integer    int64
 *   2 Real       float32
 *
 * An index past the node's last parameter answers with an all-Empty response
 * and an empty name: four zero bytes.
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

/** Response padding ahead of each `Value` and each `NumericValue`. */
const VALUE_PAD_BITS = 5;
const NUMERIC_VALUE_PAD_BITS = 6;

/** DSDL caps `GetSet.name` at 92 bytes and `Value.string_value` at 128. */
const NAME_MAX_BYTES = 92;
const STRING_VALUE_MAX_BYTES = 128;

/** Width of the `string_value` length prefix: ceil(log2(128 + 1)) = 8 bits. */
const STRING_LENGTH_BITS = 8;

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
      w.write(bytes.length, STRING_LENGTH_BITS);
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
  // NumericValue has three members, so its 2-bit tag value 3 is malformed.
  if (tagBits === NUMERIC_VALUE_TAG_BITS && tag > ValueTag.Real) return null;
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
      if (r.remaining() < STRING_LENGTH_BITS) return null;
      const length = r.read(STRING_LENGTH_BITS);
      if (length > STRING_VALUE_MAX_BYTES || r.remaining() < length * 8) {
        return null;
      }
      return { tag: ValueTag.String, value: readString(r, length) };
    }
    default:
      // A tag outside the union is a malformed frame, not an Empty value.
      return null;
  }
}

/** Read `count` bytes from the stream (at any bit offset) as UTF-8. */
function readString(r: BitReader, count: number): string {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = r.read(8);
  return new TextDecoder().decode(out);
}

/** Skip the response's void padding, reporting a stream that ends inside it. */
function skipPad(r: BitReader, bits: number, field: string): void {
  if (r.remaining() < bits) {
    throw new Error(`ParamGetSetResponse: truncated before ${field}`);
  }
  r.skip(bits);
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
  const name = readString(r, Math.floor(r.remaining() / 8));
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
  w.write(0, VALUE_PAD_BITS);
  writeValue(w, res.value, VALUE_TAG_BITS);
  w.write(0, VALUE_PAD_BITS);
  writeValue(w, res.default_value, VALUE_TAG_BITS);
  w.write(0, NUMERIC_VALUE_PAD_BITS);
  writeValue(w, res.max_value, NUMERIC_VALUE_TAG_BITS);
  w.write(0, NUMERIC_VALUE_PAD_BITS);
  writeValue(w, res.min_value, NUMERIC_VALUE_TAG_BITS);
  for (const b of nameBytes) w.write(b, 8);
  return w.toUint8Array();
}

export function decodeParamGetSetResponse(
  buf: Uint8Array,
): ParamGetSetResponse {
  const r = new BitReader(buf);

  skipPad(r, VALUE_PAD_BITS, "value");
  const value = readValue(r, VALUE_TAG_BITS);
  if (value === null) {
    throw new Error("ParamGetSetResponse: truncated value field");
  }
  skipPad(r, VALUE_PAD_BITS, "default_value");
  const defaultValue = readValue(r, VALUE_TAG_BITS);
  skipPad(r, NUMERIC_VALUE_PAD_BITS, "max_value");
  const maxValue = readValue(r, NUMERIC_VALUE_TAG_BITS);
  skipPad(r, NUMERIC_VALUE_PAD_BITS, "min_value");
  const minValue = readValue(r, NUMERIC_VALUE_TAG_BITS);
  if (defaultValue === null || maxValue === null || minValue === null) {
    throw new Error("ParamGetSetResponse: truncated or malformed value field");
  }
  const name = readString(r, Math.floor(r.remaining() / 8));

  return {
    value,
    default_value: defaultValue,
    max_value: maxValue,
    min_value: minValue,
    name,
  };
}
