import { describe, it, expect } from "vitest";
import {
  detectChipFamily,
  chipFamilyRequiresReboot,
} from "@/lib/board-profiles/family";

// Board ids are the APJ_BOARD_ID each firmware build reports in the upper 16
// bits of AUTOPILOT_VERSION.board_version.
describe("detectChipFamily", () => {
  it.each<[string, number, string]>([
    ["SpeedyBee F405 Wing", 1106, "F4"],
    ["SpeedyBee F405 V3", 1082, "F4"],
    ["Matek F405-Wing", 127, "F4"],
    ["CubeBlack / Pixhawk 1 (FMUv3)", 9, "F4"],
    ["Pixhawk 4 (FMUv5)", 50, "F7"],
    ["Kakute F7", 123, "F7"],
    ["Matek F765-Wing", 143, "F7"],
    ["Matek H743", 1013, "H7"],
    ["Pixhawk 6X", 53, "H7"],
    ["CubeOrange", 140, "H7"],
    ["CubeOrange+", 1063, "H7"],
    ["Durandal", 139, "H7"],
    ["Pixhawk 5X (no registry row)", 51, "F7"],
    ["Matek H7A3 (no registry row)", 1149, "H7"],
  ])("resolves %s (board id %i) to %s", (_name, id, family) => {
    expect(detectChipFamily(id)).toBe(family);
  });

  // F405 boards whose ids were once mislabelled as F7/H7 boards must take the
  // reboot path, never the no-reboot CAN_FORWARD hot switch.
  it.each<[string, number]>([
    ["Skystars F405 DJI", 1045],
    ["Matek F405-TE", 1054],
    ["JHEMCU GSF405A", 1059],
    ["Carbonix F405", 1064],
  ])("resolves %s (board id %i) to F4", (_name, id) => {
    expect(detectChipFamily(id)).toBe("F4");
  });

  it("falls back to F4 when the board ID is unknown", () => {
    expect(detectChipFamily(987654)).toBe("F4");
  });
});

describe("chipFamilyRequiresReboot", () => {
  it("returns true for F4", () => {
    expect(chipFamilyRequiresReboot("F4")).toBe(true);
  });

  it("returns true for unknown (conservative default)", () => {
    expect(chipFamilyRequiresReboot("unknown")).toBe(true);
  });

  it("returns false for F7", () => {
    expect(chipFamilyRequiresReboot("F7")).toBe(false);
  });

  it("returns false for H7", () => {
    expect(chipFamilyRequiresReboot("H7")).toBe(false);
  });

  it("returns false for G4", () => {
    expect(chipFamilyRequiresReboot("G4")).toBe(false);
  });
});
