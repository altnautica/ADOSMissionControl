/**
 * The 4-byte value field of MAVLink PARAM_VALUE and PARAM_SET.
 *
 * The field is declared `float`, and autopilots disagree on what it holds for
 * an integer parameter:
 *
 *   - ArduPilot casts. An INT32 of 5 travels as the float 5.0
 *     (MAV_PROTOCOL_CAPABILITY_PARAM_ENCODE_C_CAST).
 *   - PX4 copies bytes. An INT32 of 5 travels as the bytes `05 00 00 00`,
 *     which read as a float are a denormal near 7e-45
 *     (MAV_PROTOCOL_CAPABILITY_PARAM_ENCODE_BYTEWISE).
 *
 * REAL32 parameters are a float under both schemes. Which integer type a
 * parameter has is only known from the vehicle's own PARAM_VALUE.
 *
 * @module protocol/param-value-codec
 */

import type { FirmwareType } from './types'

/** MAV_PARAM_TYPE_REAL32: the type every param has on the wire when unknown on a cast-encoding vehicle. */
export const MAV_PARAM_TYPE_REAL32 = 9

/**
 * True when the firmware packs integer parameters bytewise into the float
 * field. PX4 does; ArduPilot casts.
 */
export function usesBytewiseParamValues(firmwareType: FirmwareType | undefined): boolean {
  return firmwareType === 'px4'
}

/**
 * Read the value field at `offset`. With `bytewise`, MAV_PARAM_TYPE 1-6
 * (UINT8..INT32) are read from the low bytes as that integer type; every
 * other case reads the float.
 */
export function readParamWireValue(dv: DataView, offset: number, paramType: number, bytewise: boolean): number {
  if (bytewise) {
    switch (paramType) {
      case 1: return dv.getUint8(offset)
      case 2: return dv.getInt8(offset)
      case 3: return dv.getUint16(offset, true)
      case 4: return dv.getInt16(offset, true)
      case 5: return dv.getUint32(offset, true)
      case 6: return dv.getInt32(offset, true)
    }
  }
  return dv.getFloat32(offset, true)
}

/**
 * Write `value` into the value field at `offset`, the inverse of
 * {@link readParamWireValue}. A bytewise integer is rounded and written into
 * the low bytes; the remaining bytes of the field stay as they are (zero in a
 * fresh payload).
 */
export function writeParamWireValue(dv: DataView, offset: number, value: number, paramType: number, bytewise: boolean): void {
  if (bytewise) {
    const n = Math.round(value)
    switch (paramType) {
      case 1: dv.setUint8(offset, n); return
      case 2: dv.setInt8(offset, n); return
      case 3: dv.setUint16(offset, n, true); return
      case 4: dv.setInt16(offset, n, true); return
      case 5: dv.setUint32(offset, n, true); return
      case 6: dv.setInt32(offset, n, true); return
    }
  }
  dv.setFloat32(offset, value, true)
}
