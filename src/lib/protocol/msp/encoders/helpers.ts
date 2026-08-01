/**
 * Byte-buffer helpers for MSP payload encoders. All multi-byte writes are
 * little-endian to match MSP wire convention.
 *
 * The `push*` writers below narrow silently: an out-of-range value becomes a
 * different in-range one rather than an error. They remain for the settings
 * encoders that have always used them, and are folder-local — nothing outside
 * this directory imports them. New encoders, and any encoder on a path that
 * writes to a flying aircraft, use the range-checked writers in
 * `protocol/encoders/bounds` instead, which refuse an out-of-range value.
 *
 * @module protocol/msp/encoders/helpers
 */

export function makeBuffer(size: number): { buf: Uint8Array; dv: DataView } {
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  return { buf, dv };
}

export function push8(dv: DataView, offset: number, val: number): void {
  dv.setUint8(offset, val & 0xff);
}

export function push16(dv: DataView, offset: number, val: number): void {
  dv.setUint16(offset, val & 0xffff, true);
}

export function push32(dv: DataView, offset: number, val: number): void {
  dv.setUint32(offset, val >>> 0, true);
}
