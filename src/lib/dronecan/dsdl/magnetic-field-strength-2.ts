/**
 * @module magnetic-field-strength-2
 * @description Codec for `uavcan.equipment.ahrs.MagneticFieldStrength2`
 * (data type id 1002).
 *
 * Wire layout (byte aligned; each float16 is its two little-endian bytes):
 *   uint8        sensor_id
 *   float16[3]   magnetic_field_ga
 *   float16[<=9] magnetic_field_covariance   (tail array, no length prefix)
 *
 * Decode-first: the GCS subscribes to these broadcasts but does not
 * normally emit them. `encodeMagneticFieldStrength2` is provided for
 * symmetry and tests.
 *
 * @license GPL-3.0-only
 */

import { BitReader, BitWriter } from "../bit-buffer";

/** Maximum length of the covariance tail array. */
export const MAG2_COVARIANCE_MAX = 9;

export interface MagneticFieldStrength2 {
  sensorId: number;
  magneticFieldGa: [number, number, number];
  magneticFieldCovariance: number[];
}

/** Decode a `MagneticFieldStrength2` broadcast payload. */
export function decodeMagneticFieldStrength2(
  buf: Uint8Array,
): MagneticFieldStrength2 {
  const r = new BitReader(buf);
  const sensorId = r.read(8);
  const x = r.readFloat16();
  const y = r.readFloat16();
  const z = r.readFloat16();
  const cov: number[] = [];
  while (r.remaining() >= 16 && cov.length < MAG2_COVARIANCE_MAX) {
    cov.push(r.readFloat16());
  }
  return {
    sensorId,
    magneticFieldGa: [x, y, z],
    magneticFieldCovariance: cov,
  };
}

/** Encode a `MagneticFieldStrength2` broadcast payload. */
export function encodeMagneticFieldStrength2(
  msg: MagneticFieldStrength2,
): Uint8Array {
  if (msg.magneticFieldCovariance.length > MAG2_COVARIANCE_MAX) {
    throw new RangeError(
      `magnetic_field_covariance has ${msg.magneticFieldCovariance.length} entries; max ${MAG2_COVARIANCE_MAX}`,
    );
  }
  const w = new BitWriter();
  w.write(msg.sensorId & 0xff, 8);
  for (const v of msg.magneticFieldGa) w.writeFloat16(v);
  for (const v of msg.magneticFieldCovariance) w.writeFloat16(v);
  return w.toUint8Array();
}
