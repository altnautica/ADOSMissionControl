/**
 * Shared types, helpers, and factories for the virtual-parameter registry.
 *
 * @module protocol/msp/virtual-params/types
 */

// ── MSP Command IDs (inline literals matching msp-constants.ts) ──

// Read commands
export const MSP_BATTERY_CONFIG = 32;
export const MSP_FEATURE_CONFIG = 36;
export const MSP_ARMING_CONFIG = 61;
export const MSP_FAILSAFE_CONFIG = 75;
export const MSP_BLACKBOX_CONFIG = 80;
export const MSP_VTX_CONFIG = 88;
export const MSP_ADVANCED_CONFIG = 90;
export const MSP_FILTER_CONFIG = 92;
export const MSP_PID_ADVANCED = 94;
export const MSP_RC_TUNING = 111;
export const MSP_PID = 112;
export const MSP_MOTOR_CONFIG = 131;
export const MSP_GPS_CONFIG = 132;
export const MSP_GPS_RESCUE = 135;
export const MSP_BEEPER_CONFIG = 184;

// Write commands
export const MSP_SET_BATTERY_CONFIG = 33;
export const MSP_SET_FEATURE_CONFIG = 37;
export const MSP_SET_ARMING_CONFIG = 62;
export const MSP_SET_FAILSAFE_CONFIG = 76;
export const MSP_SET_BLACKBOX_CONFIG = 81;
export const MSP_SET_VTX_CONFIG = 89;
export const MSP_SET_ADVANCED_CONFIG = 91;
export const MSP_SET_FILTER_CONFIG = 93;
export const MSP_SET_PID_ADVANCED = 95;
export const MSP_SET_PID = 202;
export const MSP_SET_RC_TUNING = 204;
export const MSP_SET_MOTOR_CONFIG = 222;
export const MSP_SET_GPS_CONFIG = 223;
export const MSP_SET_GPS_RESCUE = 225;
export const MSP_SET_BEEPER_CONFIG = 185;

// ── Types ────────────────────────────────────────────────────

export interface VirtualParamDef {
  /** MSP command to read this param's value */
  readCmd: number;
  /** MSP command to write this param's value */
  writeCmd: number;
  /**
   * Byte length the read payload must have for this param to be present.
   * Older firmware sends shorter payloads; a field past the end is absent,
   * not zero.
   */
  readEnd: number;
  /** The firmware reports this value but does not accept writes to it. */
  readOnly?: boolean;
  /** Extract this param's value from the read response payload */
  decode: (payload: Uint8Array) => number;
  /**
   * Patch this param's value into a write payload (laid out as the write
   * command expects). Returns a new payload.
   */
  encode: (value: number, writePayload: Uint8Array) => Uint8Array;
  /** Data type for UI hints */
  type: 'uint8' | 'uint16' | 'int16' | 'uint32' | 'float';
  min?: number;
  max?: number;
  description?: string;
}

// ── Payload read/write helpers ───────────────────────────────

export function getU8(payload: Uint8Array, offset: number): number {
  return payload[offset] ?? 0;
}

export function getU16(payload: Uint8Array, offset: number): number {
  return (payload[offset] ?? 0) | ((payload[offset + 1] ?? 0) << 8);
}

export function getS16(payload: Uint8Array, offset: number): number {
  const val = getU16(payload, offset);
  return val > 0x7fff ? val - 0x10000 : val;
}

export function getU32(payload: Uint8Array, offset: number): number {
  return (
    ((payload[offset] ?? 0) |
      ((payload[offset + 1] ?? 0) << 8) |
      ((payload[offset + 2] ?? 0) << 16) |
      ((payload[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

export function setU8(payload: Uint8Array, offset: number, val: number): Uint8Array {
  const out = new Uint8Array(payload);
  out[offset] = val & 0xff;
  return out;
}

export function setU16(payload: Uint8Array, offset: number, val: number): Uint8Array {
  const out = new Uint8Array(payload);
  out[offset] = val & 0xff;
  out[offset + 1] = (val >> 8) & 0xff;
  return out;
}

export function setU32(payload: Uint8Array, offset: number, val: number): Uint8Array {
  const out = new Uint8Array(payload);
  const v = val >>> 0;
  out[offset] = v & 0xff;
  out[offset + 1] = (v >> 8) & 0xff;
  out[offset + 2] = (v >> 16) & 0xff;
  out[offset + 3] = (v >> 24) & 0xff;
  return out;
}

// ── Helper factories ─────────────────────────────────────────

export function u8Param(
  readCmd: number,
  writeCmd: number,
  readOffset: number,
  writeOffset: number,
  description?: string,
  min?: number,
  max?: number,
): VirtualParamDef {
  return {
    readCmd,
    writeCmd,
    readEnd: readOffset + 1,
    decode: (p) => getU8(p, readOffset),
    encode: (v, p) => setU8(p, writeOffset, v),
    type: 'uint8',
    min,
    max,
    description,
  };
}

export function u16Param(
  readCmd: number,
  writeCmd: number,
  readOffset: number,
  writeOffset: number,
  description?: string,
  min?: number,
  max?: number,
): VirtualParamDef {
  return {
    readCmd,
    writeCmd,
    readEnd: readOffset + 2,
    decode: (p) => getU16(p, readOffset),
    encode: (v, p) => setU16(p, writeOffset, v),
    type: 'uint16',
    min,
    max,
    description,
  };
}

export function u32Param(
  readCmd: number,
  writeCmd: number,
  readOffset: number,
  writeOffset: number,
  description?: string,
): VirtualParamDef {
  return {
    readCmd,
    writeCmd,
    readEnd: readOffset + 4,
    decode: (p) => getU32(p, readOffset),
    encode: (v, p) => setU32(p, writeOffset, v),
    type: 'uint32',
    description,
  };
}
