/**
 * @license GPL-3.0-only
 *
 * Expected bytes are reference DroneCAN encodings of `uavcan.equipment.gnss.Fix2`,
 * checked in both directions. Fix2 packs int37/int27/uint6 fields across byte
 * boundaries, so a wrong bit order garbles position, altitude and fix status.
 */

import { describe, expect, it } from "vitest";
import {
  GNSS_TIME_STANDARD_UTC,
  MODE_SINGLE,
  STATUS_3D_FIX,
  decodeFix2,
  encodeFix2,
  type GnssFix2,
} from "@/lib/dronecan/dsdl/gnss-fix2";

function syntheticFix(): GnssFix2 {
  return {
    timestamp: { usecMonotonic: BigInt(1700000000000000) },
    gnssTimestamp: { usecMonotonic: BigInt(1700000000005000) },
    gnssTimeStandard: GNSS_TIME_STANDARD_UTC,
    numLeapSeconds: 18,
    latitudeDeg1e8: BigInt(3777490000),
    longitudeDeg1e8: BigInt(-12241940000),
    heightEllipsoidMm: 50_000,
    heightMslMm: 16_000,
    nedVelocity: [0.5, -0.25, 0.0],
    satsUsed: 12,
    status: STATUS_3D_FIX,
    mode: MODE_SINGLE,
    subMode: 0,
    covariance: [0.5, 0.0, 0.0, 0.5, 0.0, 1.0],
    pdop: 1.5,
    ecefPositionVelocity: undefined,
  };
}

function syntheticFixWithEcef(): GnssFix2 {
  return {
    ...syntheticFix(),
    ecefPositionVelocity: {
      velocityXyz: [1.0, -2.0, 3.0],
      positionXyzMm: [BigInt(123456789), BigInt(-987654321), BigInt(50_000_000)],
      covariance: [0.5, 0.25, 2.0],
    },
  };
}

const FIX2_BYTES = [
  0x00, 0x40, 0x1e, 0x18, 0x24, 0x0a, 0x06, 0x88, 0x53, 0x1e, 0x18, 0x24, 0x0a, 0x06, 0x40, 0x00,
  0x12, 0xe0, 0xd1, 0x52, 0x26, 0xea, 0x87, 0x61, 0x3f, 0x08, 0x14, 0x30, 0xc0, 0x04, 0x01, 0xf0,
  0x00, 0x00, 0x00, 0x00, 0x3f, 0x00, 0x00, 0x80, 0xbe, 0x00, 0x00, 0x00, 0x00, 0x33, 0x00, 0x06,
  0x00, 0x38, 0x00, 0x00, 0x00, 0x00, 0x00, 0x38, 0x00, 0x00, 0x00, 0x3c, 0x00, 0x3e,
];

// The ECEF block follows pdop. Its inner covariance keeps its uint6 count (the
// 0x03 before the three float16 entries): a tail-optimized composite array
// encodes its elements without the optimization.
const FIX2_ECEF_BYTES = [
  ...FIX2_BYTES,
  0x00, 0x00, 0x80, 0x3f, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x40, 0x40, 0x15, 0xcd, 0x5b, 0x07,
  0x04, 0xf9, 0x72, 0x1c, 0x5f, 0x80, 0xf0, 0xfa, 0x02, 0x00, 0x03, 0x00, 0x38, 0x00, 0x34, 0x00,
  0x40,
];

describe("dsdl gnss.Fix2", () => {
  it("encodes a 3D fix without an ECEF block to the reference bytes", () => {
    expect(Array.from(encodeFix2(syntheticFix()))).toEqual(FIX2_BYTES);
  });

  it("decodes the reference bytes of a 3D fix without an ECEF block", () => {
    expect(decodeFix2(new Uint8Array(FIX2_BYTES))).toEqual(syntheticFix());
  });

  it("encodes a 3D fix with an ECEF block to the reference bytes", () => {
    expect(Array.from(encodeFix2(syntheticFixWithEcef()))).toEqual(FIX2_ECEF_BYTES);
  });

  it("decodes the reference bytes of a 3D fix with an ECEF block", () => {
    expect(decodeFix2(new Uint8Array(FIX2_ECEF_BYTES))).toEqual(syntheticFixWithEcef());
  });
});
