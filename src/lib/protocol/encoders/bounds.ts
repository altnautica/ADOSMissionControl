/**
 * Range-checked integer writes for protocol encoders.
 *
 * A `DataView` setter and a raw `payload[n] = x` store both narrow silently:
 * 256 written to a byte becomes 0, -1 becomes 255, and 70000 written to a
 * 16-bit field becomes 4464. Every one of those is a valid-looking value on the
 * wire, so a caller's mistake reaches the aircraft as a different, plausible
 * instruction rather than as an error. Waypoint 256 addressing waypoint 0 and
 * overwriting the first item of a mission is the shape of the problem.
 *
 * These writers refuse instead. The callers that normalise operator input keep
 * doing so — clamping a stick axis is the right behaviour there — and these sit
 * underneath as the assertion that the normalisation actually happened.
 *
 * @module protocol/encoders/bounds
 */

/** Reject anything that is not a whole finite number before range-testing it. */
function requireInt(value: number, field: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${field}: expected a whole number, received ${String(value)}`);
  }
}

function requireRange(value: number, min: number, max: number, field: string): void {
  requireInt(value, field);
  if (value < min || value > max) {
    throw new RangeError(`${field}: expected ${min}..${max}, received ${value}`);
  }
}

/** Write an unsigned byte, refusing anything outside 0..255. */
export function writeU8(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, 0, 0xff, field);
  dv.setUint8(offset, value);
}

/** Write an unsigned byte directly into a payload array, refusing 0..255 misses. */
export function setU8(payload: Uint8Array, index: number, value: number, field: string): void {
  requireRange(value, 0, 0xff, field);
  payload[index] = value;
}

/** Write a little-endian unsigned 16-bit field, refusing anything outside 0..65535. */
export function writeU16(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, 0, 0xffff, field);
  dv.setUint16(offset, value, true);
}

/** Write a little-endian signed 16-bit field, refusing anything outside -32768..32767. */
export function writeI16(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, -0x8000, 0x7fff, field);
  dv.setInt16(offset, value, true);
}

/**
 * Write a 16-bit field whose reader interprets it as signed while the writer
 * has historically emitted it unsigned. Both halves of that range are accepted
 * and produce the same bit pattern; only a value that fits in neither is
 * refused.
 */
export function writeBits16(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, -0x8000, 0xffff, field);
  if (value < 0) dv.setInt16(offset, value, true);
  else dv.setUint16(offset, value, true);
}

/** Write a little-endian signed 32-bit field, refusing anything outside the int32 range. */
export function writeI32(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, -0x80000000, 0x7fffffff, field);
  dv.setInt32(offset, value, true);
}

/** Write a little-endian unsigned 32-bit field, refusing anything outside 0..4294967295. */
export function writeU32(dv: DataView, offset: number, value: number, field: string): void {
  requireRange(value, 0, 0xffffffff, field);
  dv.setUint32(offset, value, true);
}
