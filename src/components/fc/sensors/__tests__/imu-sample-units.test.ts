/**
 * @module fc/sensors/imu-sample-units.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { imuSampleFromScaled } from "../waveform-chart";

describe("imuSampleFromScaled", () => {
  const raw = {
    timestamp: 1, imu: 1,
    xacc: 0, yacc: 0, zacc: -1000,
    xgyro: 1000, ygyro: 0, zgyro: 0,
    xmag: 200, ymag: 0, zmag: 400,
  };

  it("converts SCALED_IMU milli-g to m/s²", () => {
    expect(imuSampleFromScaled(raw).zacc).toBeCloseTo(-9.80665, 4);
  });

  it("converts mrad/s to deg/s", () => {
    expect(imuSampleFromScaled(raw).xgyro).toBeCloseTo(57.2958, 3);
  });

  it("keeps the field in milligauss", () => {
    expect(imuSampleFromScaled(raw).zmag).toBe(400);
  });
});
