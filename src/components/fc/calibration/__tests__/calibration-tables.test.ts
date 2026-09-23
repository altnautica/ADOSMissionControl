import { describe, it, expect } from "vitest";
import { ACCEL_STEPS, MAG_CAL_FAIL_MESSAGES } from "../calibration-types";
import { PX4_ORIENTATION_STEP } from "../px4-cal-parser";
import { inavAccelCaptureOutcome } from "../msp-calibration";

describe("PX4 accel orientation names map to the matching wizard step", () => {
  it.each([
    ["down", "Level"],
    ["left", "Left Side"],
    ["right", "Right Side"],
    ["front", "Nose Down"],
    ["back", "Nose Up"],
    ["up", "Back"],
  ])("%s -> %s", (px4Name, stepLabel) => {
    expect(ACCEL_STEPS[PX4_ORIENTATION_STEP[px4Name]].label).toBe(stepLabel);
  });
});

describe("MAG_CAL_STATUS failure diagnoses", () => {
  it("6 (FAILED_ORIENTATION) points at the compass orientation, not rotation technique", () => {
    const info = MAG_CAL_FAIL_MESSAGES[6];
    expect(info.message).toMatch(/orientation/i);
    expect(info.fixes.join(" ")).toMatch(/COMPASS_ORIENT/);
    expect(info.fixes.join(" ")).not.toMatch(/slowly/i);
  });

  it("5 (FAILED) is a generic fit failure, not interference", () => {
    expect(MAG_CAL_FAIL_MESSAGES[5].message).not.toMatch(/interference/i);
  });
});

describe("iNav six-orientation accel capture outcome", () => {
  it("a capture that sets no new flag is not progress, whatever the command reply said", () => {
    expect(inavAccelCaptureOutcome(0b000011, 0b000011)).toBe("none");
  });

  it("a new flag is a captured orientation", () => {
    expect(inavAccelCaptureOutcome(0b000001, 0b000101)).toBe("captured");
  });

  it("the sixth orientation completes the calibration", () => {
    expect(inavAccelCaptureOutcome(0b011111, 0b111111)).toBe("complete");
  });

  it("flags cleared after the sixth capture mean iNav rejected the fit", () => {
    expect(inavAccelCaptureOutcome(0b101111, 0)).toBe("rejected");
  });

  it("top-up on a calibrated board restarts the sequence", () => {
    expect(inavAccelCaptureOutcome(0b111111, 0b000001)).toBe("captured");
  });

  it("a non-top-up capture on a calibrated board changes nothing", () => {
    expect(inavAccelCaptureOutcome(0b111111, 0b111111)).toBe("none");
  });
});
