/**
 * Shared DataView reader helpers for MSP decoders.
 *
 * All multi-byte values are little-endian (matching MSP wire format).
 *
 * @module protocol/msp/msp-decode-utils
 */

export function readU8(dv: DataView, offset: number): number {
  return dv.getUint8(offset);
}

export function readU16(dv: DataView, offset: number): number {
  return dv.getUint16(offset, true);
}

export function readS16(dv: DataView, offset: number): number {
  return dv.getInt16(offset, true);
}

export function readU32(dv: DataView, offset: number): number {
  return dv.getUint32(offset, true);
}

export function readS32(dv: DataView, offset: number): number {
  return dv.getInt32(offset, true);
}

export function readString(dv: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) {
    s += String.fromCharCode(dv.getUint8(offset + i));
  }
  return s;
}
