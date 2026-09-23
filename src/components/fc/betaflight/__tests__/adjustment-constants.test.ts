/**
 * @module fc/betaflight/adjustment-constants.test
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { ADJUSTMENT_FUNCTIONS, ADJUSTMENT_FUNCTION_NAMES, adjustmentFunctionLabel } from "../adjustment-constants";

/**
 * Betaflight `adjustmentFunction_e` (fc/rc_adjustments.h), in declaration
 * order. The ordinal is the byte MSP_SET_ADJUSTMENT_RANGE writes.
 */
const FIRMWARE_ENUM = [
  "ADJUSTMENT_NONE",
  "ADJUSTMENT_RC_RATE",
  "ADJUSTMENT_RC_EXPO",
  "ADJUSTMENT_THROTTLE_EXPO",
  "ADJUSTMENT_PITCH_ROLL_RATE",
  "ADJUSTMENT_YAW_RATE",
  "ADJUSTMENT_PITCH_ROLL_P",
  "ADJUSTMENT_PITCH_ROLL_I",
  "ADJUSTMENT_PITCH_ROLL_D",
  "ADJUSTMENT_YAW_P",
  "ADJUSTMENT_YAW_I",
  "ADJUSTMENT_YAW_D",
  "ADJUSTMENT_RATE_PROFILE",
  "ADJUSTMENT_PITCH_RATE",
  "ADJUSTMENT_ROLL_RATE",
  "ADJUSTMENT_PITCH_P",
  "ADJUSTMENT_PITCH_I",
  "ADJUSTMENT_PITCH_D",
  "ADJUSTMENT_ROLL_P",
  "ADJUSTMENT_ROLL_I",
  "ADJUSTMENT_ROLL_D",
  "ADJUSTMENT_RC_RATE_YAW",
  "ADJUSTMENT_PITCH_ROLL_F",
  "ADJUSTMENT_FEEDFORWARD_TRANSITION",
  "ADJUSTMENT_HORIZON_STRENGTH",
  "ADJUSTMENT_ROLL_RC_RATE",
  "ADJUSTMENT_PITCH_RC_RATE",
  "ADJUSTMENT_ROLL_RC_EXPO",
  "ADJUSTMENT_PITCH_RC_EXPO",
  "ADJUSTMENT_PID_AUDIO",
  "ADJUSTMENT_PITCH_F",
  "ADJUSTMENT_ROLL_F",
  "ADJUSTMENT_YAW_F",
  "ADJUSTMENT_OSD_PROFILE",
  "ADJUSTMENT_LED_PROFILE",
] as const;

/** Display label each firmware function must carry. */
const LABEL_FOR: Record<(typeof FIRMWARE_ENUM)[number], string> = {
  ADJUSTMENT_NONE: "None",
  ADJUSTMENT_RC_RATE: "RC Rate",
  ADJUSTMENT_RC_EXPO: "RC Expo",
  ADJUSTMENT_THROTTLE_EXPO: "Throttle Expo",
  ADJUSTMENT_PITCH_ROLL_RATE: "Pitch & Roll Rate",
  ADJUSTMENT_YAW_RATE: "Yaw Rate",
  ADJUSTMENT_PITCH_ROLL_P: "Pitch & Roll P",
  ADJUSTMENT_PITCH_ROLL_I: "Pitch & Roll I",
  ADJUSTMENT_PITCH_ROLL_D: "Pitch & Roll D",
  ADJUSTMENT_YAW_P: "Yaw P",
  ADJUSTMENT_YAW_I: "Yaw I",
  ADJUSTMENT_YAW_D: "Yaw D",
  ADJUSTMENT_RATE_PROFILE: "Rate Profile",
  ADJUSTMENT_PITCH_RATE: "Pitch Rate",
  ADJUSTMENT_ROLL_RATE: "Roll Rate",
  ADJUSTMENT_PITCH_P: "Pitch P",
  ADJUSTMENT_PITCH_I: "Pitch I",
  ADJUSTMENT_PITCH_D: "Pitch D",
  ADJUSTMENT_ROLL_P: "Roll P",
  ADJUSTMENT_ROLL_I: "Roll I",
  ADJUSTMENT_ROLL_D: "Roll D",
  ADJUSTMENT_RC_RATE_YAW: "RC Rate Yaw",
  ADJUSTMENT_PITCH_ROLL_F: "Pitch & Roll Feedforward",
  ADJUSTMENT_FEEDFORWARD_TRANSITION: "Feedforward Transition",
  ADJUSTMENT_HORIZON_STRENGTH: "Horizon Strength",
  ADJUSTMENT_ROLL_RC_RATE: "Roll RC Rate",
  ADJUSTMENT_PITCH_RC_RATE: "Pitch RC Rate",
  ADJUSTMENT_ROLL_RC_EXPO: "Roll RC Expo",
  ADJUSTMENT_PITCH_RC_EXPO: "Pitch RC Expo",
  ADJUSTMENT_PID_AUDIO: "PID Audio",
  ADJUSTMENT_PITCH_F: "Pitch Feedforward",
  ADJUSTMENT_ROLL_F: "Roll Feedforward",
  ADJUSTMENT_YAW_F: "Yaw Feedforward",
  ADJUSTMENT_OSD_PROFILE: "OSD Profile",
  ADJUSTMENT_LED_PROFILE: "LED Profile",
};

describe("Betaflight adjustment functions", () => {
  it("carries every firmware function at its enum ordinal", () => {
    expect(ADJUSTMENT_FUNCTION_NAMES.length).toBe(FIRMWARE_ENUM.length);
    FIRMWARE_ENUM.forEach((cName, ordinal) => {
      expect(ADJUSTMENT_FUNCTION_NAMES[ordinal], cName).toBe(LABEL_FOR[cName]);
    });
  });

  it("writes the ordinal as the select value", () => {
    expect(ADJUSTMENT_FUNCTIONS.find((f) => f.label === "Rate Profile")?.value).toBe("12");
    expect(ADJUSTMENT_FUNCTIONS.find((f) => f.label === "Roll P")?.value).toBe("18");
    expect(ADJUSTMENT_FUNCTIONS.find((f) => f.label === "Yaw P")?.value).toBe("9");
    expect(ADJUSTMENT_FUNCTIONS.find((f) => f.label === "RC Rate")?.value).toBe("1");
  });

  it("shows an unknown function as its raw number", () => {
    expect(adjustmentFunctionLabel(0)).toBe("None");
    expect(adjustmentFunctionLabel(99)).toBe("Function 99");
  });
});
