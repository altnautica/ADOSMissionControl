/**
 * @license GPL-3.0-only
 *
 * Expected bytes are a reference DroneCAN encoding of
 * `uavcan.equipment.ahrs.MagneticFieldStrength2`, checked in both directions.
 */

import { describe, expect, it } from "vitest";
import {
  decodeMagneticFieldStrength2,
  encodeMagneticFieldStrength2,
} from "@/lib/dronecan/dsdl/magnetic-field-strength-2";

// sensor_id = 7, field = [1.0, -1.0, 0.5] Ga, no covariance. The payload is
// byte aligned, so each float16 is its two little-endian bytes.
const MSG = {
  sensorId: 7,
  magneticFieldGa: [1, -1, 0.5] as [number, number, number],
  magneticFieldCovariance: [],
};
const BYTES = [0x07, 0x00, 0x3c, 0x00, 0xbc, 0x00, 0x38];

describe("dsdl MagneticFieldStrength2", () => {
  it("encodes to the reference bytes", () => {
    expect(Array.from(encodeMagneticFieldStrength2(MSG))).toEqual(BYTES);
  });

  it("decodes the reference bytes", () => {
    expect(decodeMagneticFieldStrength2(new Uint8Array(BYTES))).toEqual(MSG);
  });

  it("reads the covariance tail array from the remaining bytes", () => {
    const decoded = decodeMagneticFieldStrength2(
      new Uint8Array([...BYTES, 0x00, 0x38, 0x00, 0x3c]),
    );
    expect(decoded.magneticFieldCovariance).toEqual([0.5, 1]);
  });
});
