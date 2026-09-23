/**
 * @license GPL-3.0-only
 *
 * The MSP sensor word packs bits differently than MAVLink's
 * MAV_SYS_STATUS_SENSOR mask the sensor-health surfaces decode, so an MSP
 * bitmask fed straight into the MAVLink fields mislabels every chip. These
 * tests pin the firmware-aware translation.
 */

import { describe, it, expect } from "vitest";

import { mspSensorFlagsToMavlink } from "../msp-mavlink-semantics";

// MAVLink MAV_SYS_STATUS_SENSOR positions.
const MAV_GYRO = 1 << 0;
const MAV_ACCEL = 1 << 1;
const MAV_MAG = 1 << 2;
const MAV_ABS_PRESSURE = 1 << 3;
const MAV_DIFF_PRESSURE = 1 << 4;
const MAV_GPS = 1 << 5;
const MAV_OPTICAL_FLOW = 1 << 6;
const MAV_LASER_POSITION = 1 << 8;

// MSP sensor word positions.
const MSP_ACC = 1 << 0;
const MSP_BARO = 1 << 1;
const MSP_MAG = 1 << 2;
const MSP_GPS = 1 << 3;
const MSP_RANGEFINDER = 1 << 4;
const MSP_BIT5 = 1 << 5;
const MSP_BIT6 = 1 << 6;

describe("mspSensorFlagsToMavlink", () => {
  it("maps the common MSP bits (acc/baro/mag/gps/rangefinder) to MAVLink positions", () => {
    expect(mspSensorFlagsToMavlink(MSP_ACC, "betaflight")).toBe(MAV_ACCEL);
    expect(mspSensorFlagsToMavlink(MSP_BARO, "betaflight")).toBe(MAV_ABS_PRESSURE);
    expect(mspSensorFlagsToMavlink(MSP_MAG, "betaflight")).toBe(MAV_MAG);
    expect(mspSensorFlagsToMavlink(MSP_GPS, "betaflight")).toBe(MAV_GPS);
    expect(mspSensorFlagsToMavlink(MSP_RANGEFINDER, "betaflight")).toBe(
      MAV_LASER_POSITION,
    );
  });

  it("does NOT decode the MSP word as if it were the MAVLink layout", () => {
    // MSP bit 0 is the accelerometer; a naive decode would call it the gyro
    // (MAVLink bit 0). The translation must move it to the accel bit.
    expect(mspSensorFlagsToMavlink(MSP_ACC, "betaflight") & MAV_GYRO).toBe(0);
    // MSP bit 3 is GPS, not the baro (MAVLink bit 3).
    expect(mspSensorFlagsToMavlink(MSP_GPS, "betaflight") & MAV_ABS_PRESSURE).toBe(
      0,
    );
  });

  it("treats MSP bit 5 as gyro on Betaflight", () => {
    expect(mspSensorFlagsToMavlink(MSP_BIT5, "betaflight")).toBe(MAV_GYRO);
  });

  it("treats MSP bit 5 as optical flow and bit 6 as pitot on iNav", () => {
    expect(mspSensorFlagsToMavlink(MSP_BIT5, "inav")).toBe(MAV_OPTICAL_FLOW);
    expect(mspSensorFlagsToMavlink(MSP_BIT6, "inav")).toBe(MAV_DIFF_PRESSURE);
    // Betaflight has no pitot on bit 6, so it maps to nothing there.
    expect(mspSensorFlagsToMavlink(MSP_BIT6, "betaflight")).toBe(0);
  });

  it("defaults an unknown/absent firmware to the Betaflight interpretation", () => {
    expect(mspSensorFlagsToMavlink(MSP_BIT5, undefined)).toBe(MAV_GYRO);
    expect(mspSensorFlagsToMavlink(MSP_BIT5, "unknown")).toBe(MAV_GYRO);
  });

  it("translates a full typical Betaflight word (acc+baro+mag+gps+gyro)", () => {
    const bf = MSP_ACC | MSP_BARO | MSP_MAG | MSP_GPS | MSP_BIT5;
    const out = mspSensorFlagsToMavlink(bf, "betaflight");
    expect(out & MAV_ACCEL).toBeTruthy();
    expect(out & MAV_ABS_PRESSURE).toBeTruthy();
    expect(out & MAV_MAG).toBeTruthy();
    expect(out & MAV_GPS).toBeTruthy();
    expect(out & MAV_GYRO).toBeTruthy();
    expect(out & MAV_OPTICAL_FLOW).toBe(0);
  });
});
