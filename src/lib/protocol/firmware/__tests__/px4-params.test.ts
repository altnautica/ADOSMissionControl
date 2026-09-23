/**
 * Tests for the PX4 parameter name map (canonical ArduPilot -> PX4).
 *
 * These assert that the map resolves the listed canonical
 * names to their genuine PX4 equivalents, that pass-through and reverse mapping
 * still behave, and that no target collides in the reverse map.
 */
import { describe, it, expect } from "vitest";
import { PX4_PARAM_MAP, PX4_REVERSE_MAP } from "../px4-params";
import { createPX4Handler } from "../px4";

describe("PX4_PARAM_MAP canonical name mappings", () => {
  const handler = createPX4Handler("copter");

  const NEW_MAPPINGS: Array<[string, string]> = [
    // Accelerometer calibration (offset + scale)
    ["INS_ACCOFFS_X", "CAL_ACC0_XOFF"],
    ["INS_ACCOFFS_Y", "CAL_ACC0_YOFF"],
    ["INS_ACCOFFS_Z", "CAL_ACC0_ZOFF"],
    ["INS_ACCSCAL_X", "CAL_ACC0_XSCALE"],
    ["INS_ACCSCAL_Z", "CAL_ACC0_ZSCALE"],
    // Gyroscope calibration offsets
    ["INS_GYROFFS_X", "CAL_GYRO0_XOFF"],
    ["INS_GYROFFS_Y", "CAL_GYRO0_YOFF"],
    ["INS_GYROFFS_Z", "CAL_GYRO0_ZOFF"],
    // Board level / AHRS trim
    ["AHRS_TRIM_X", "SENS_BOARD_X_OFF"],
    ["AHRS_TRIM_Y", "SENS_BOARD_Y_OFF"],
    ["AHRS_TRIM_Z", "SENS_BOARD_Z_OFF"],
    // Compass orientation
    ["COMPASS_ORIENT", "CAL_MAG0_ROT"],
    // GPS antenna body-frame offset
    ["GPS_POS1_X", "EKF2_GPS_POS_X"],
    ["GPS_POS1_Y", "EKF2_GPS_POS_Y"],
    ["GPS_POS1_Z", "EKF2_GPS_POS_Z"],
    // MAVLink identity
    ["SYSID_THISMAV", "MAV_SYS_ID"],
    // Camera trigger neutral PWM
    ["CAM1_SERVO_OFF", "TRIG_PWM_NEUTRAL"],
    // Optical flow orientation
    ["FLOW_ORIENT_YAW", "SENS_FLOW_ROT"],
  ];

  it.each(NEW_MAPPINGS)("maps %s -> %s in the table", (canonical, px4) => {
    expect(PX4_PARAM_MAP[canonical]).toBe(px4);
  });

  it.each(NEW_MAPPINGS)(
    "resolves %s -> %s via mapParameterName",
    (canonical, px4) => {
      expect(handler.mapParameterName(canonical)).toBe(px4);
    },
  );

  it("round-trips a new mapping through reverseMapParameterName", () => {
    expect(handler.reverseMapParameterName("MAV_SYS_ID")).toBe("SYSID_THISMAV");
    expect(handler.reverseMapParameterName("CAL_ACC0_XOFF")).toBe(
      "INS_ACCOFFS_X",
    );
    expect(handler.reverseMapParameterName("EKF2_GPS_POS_X")).toBe("GPS_POS1_X");
  });

  it("passes unmapped names through unchanged", () => {
    // Deliberately unmapped (no clean PX4 equivalent), so it passes through.
    expect(handler.mapParameterName("FRAME_CLASS")).toBe("FRAME_CLASS");
    expect(handler.mapParameterName("BATT_FS_CRT_ACT")).toBe("BATT_FS_CRT_ACT");
    expect(handler.mapParameterName("NTF_LED_BRIGHT")).toBe("NTF_LED_BRIGHT");
  });

  it("has no duplicate PX4 targets (reverse map is lossless)", () => {
    const targets = Object.values(PX4_PARAM_MAP);
    const unique = new Set(targets);
    expect(unique.size).toBe(targets.length);
    // Every forward entry survives the reverse map.
    expect(Object.keys(PX4_REVERSE_MAP).length).toBe(targets.length);
  });
});
