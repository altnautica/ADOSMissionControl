/**
 * @license GPL-3.0-only
 *
 * The PX4 airframe picker and the actuator output-function fallback write raw
 * numbers to the flight controller, so the numbers must be PX4's own:
 * SYS_AUTOSTART ids from the ROMFS airframe scripts, and the mixer module's
 * output-function codes.
 */

import { describe, it, expect } from "vitest";

import { PX4_AIRFRAMES } from "../px4-airframes";
import { PX4_OUTPUT_FUNCTION_OPTIONS } from "../px4-output-functions";

function airframeId(name: string): number | undefined {
  return PX4_AIRFRAMES.find((a) => a.name === name)?.id;
}

function functionLabel(code: number): string | undefined {
  return PX4_OUTPUT_FUNCTION_OPTIONS.find((o) => o.value === String(code))?.label;
}

describe("PX4 airframe ids", () => {
  it("selects the airframes PX4 ships under these ids", () => {
    expect(airframeId("Generic Helicopter")).toBe(16001);
    expect(airframeId("Generic Quadrotor +")).toBe(5001);
    expect(airframeId("Generic Hexarotor +")).toBe(7001);
    expect(airframeId("Generic Octorotor +")).toBe(9001);
    expect(airframeId("Holybro QAV250")).toBe(4052);
    expect(airframeId("Aion Robotics R1")).toBe(50001);
  });

  it("offers each id once", () => {
    const ids = PX4_AIRFRAMES.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("PX4 output-function codes", () => {
  it("labels the payload and passthrough functions with their PX4 codes", () => {
    expect(functionLabel(400)).toBe("Landing Gear");
    expect(functionLabel(401)).toBe("Parachute");
    expect(functionLabel(402)).toBe("RC Roll");
    expect(functionLabel(403)).toBe("RC Pitch");
    expect(functionLabel(430)).toBe("Gripper");
    expect(functionLabel(2000)).toBe("Camera Trigger");
  });

  it("covers twelve motors and fifteen servos", () => {
    expect(functionLabel(112)).toBe("Motor 12");
    expect(functionLabel(215)).toBe("Servo 15");
  });
});
