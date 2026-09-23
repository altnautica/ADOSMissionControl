/**
 * @module protocol/firmware/px4.test
 * @license GPL-3.0-only
 *
 * PX4 custom_mode packing. The union is
 * reserved(0-15) | main_mode(16-23) | sub_mode(24-31), so an AUTO submode
 * must land in the top byte. These golden values are computed from that
 * layout, independent of the implementation.
 */

import { describe, it, expect } from "vitest";
import { px4Handler, createPX4Handler } from "../px4";
import { createFirmwareHandler } from "../ardupilot";
import type { UnifiedFlightMode } from "../../types";

// HEARTBEAT enum values (common.xml).
const PX4 = 12; // MAV_AUTOPILOT_PX4
const MAV_TYPE_FIXED_WING = 1;
const MAV_TYPE_QUADROTOR = 2;
const MAV_TYPE_VTOL_TILTROTOR = 24;

// PX4 main_mode / sub_mode ids.
const MAIN = { MANUAL: 1, ALTCTL: 2, POSCTL: 3, AUTO: 4, STABILIZED: 7 };
const SUB_AUTO = { TAKEOFF: 2, LOITER: 3, MISSION: 4, RTL: 5, LAND: 6 };

/** The correct packed custom_mode for a (main, sub) pair, per the union. */
function packed(main: number, sub: number): number {
  return ((sub << 24) | (main << 16)) >>> 0;
}

describe("PX4 custom_mode packing", () => {
  it("packs a base mode (sub=0) into bits 16-23", () => {
    const { customMode } = px4Handler.encodeFlightMode("MANUAL");
    expect(customMode).toBe(packed(MAIN.MANUAL, 0));
    expect(customMode).toBe(0x00010000);
  });

  it("packs an AUTO submode into the top byte (bits 24-31), not the low bytes", () => {
    // AUTO.MISSION = main 4, sub 4 -> 0x04040000, NOT 0x00040004.
    const { customMode } = px4Handler.encodeFlightMode("MISSION");
    expect(customMode).toBe(packed(MAIN.AUTO, SUB_AUTO.MISSION));
    expect(customMode).toBe(0x04040000);
    // Guard against the old low-bits regression.
    expect(customMode).not.toBe(0x00040004);
  });

  it.each<[UnifiedFlightMode, number, number]>([
    ["MISSION", MAIN.AUTO, SUB_AUTO.MISSION],
    ["LOITER", MAIN.AUTO, SUB_AUTO.LOITER],
    ["RTL", MAIN.AUTO, SUB_AUTO.RTL],
    ["LAND", MAIN.AUTO, SUB_AUTO.LAND],
    ["TAKEOFF", MAIN.AUTO, SUB_AUTO.TAKEOFF],
  ])("encodes AUTO submode %s to the correct custom_mode", (mode, main, sub) => {
    expect(px4Handler.encodeFlightMode(mode).customMode).toBe(packed(main, sub));
  });

  // These modes have a unique (main, sub) pair so encode -> decode is exact.
  it.each<UnifiedFlightMode>([
    "MANUAL",
    "ALT_HOLD",
    "POSHOLD",
    "STABILIZE",
    "LOITER",
    "RTL",
    "LAND",
    "TAKEOFF",
  ])("round-trips %s through encode -> decode", (mode) => {
    const { customMode } = px4Handler.encodeFlightMode(mode);
    expect(px4Handler.decodeFlightMode(customMode)).toBe(mode);
  });

  it("AUTO and MISSION alias the same custom_mode (main=AUTO, sub=MISSION)", () => {
    // PX4 has no distinct AUTO mode: AUTO main + MISSION sub IS mission/auto.
    // Both encode to the same value; it decodes to the canonical 'AUTO'.
    const missionMode = packed(MAIN.AUTO, SUB_AUTO.MISSION);
    expect(px4Handler.encodeFlightMode("MISSION").customMode).toBe(missionMode);
    expect(px4Handler.encodeFlightMode("AUTO").customMode).toBe(missionMode);
    expect(px4Handler.decodeFlightMode(missionMode)).toBe("AUTO");
  });

  it("decodes a live AUTO.RTL custom_mode from the top byte", () => {
    // What a PX4 HEARTBEAT actually carries for AUTO.RTL.
    expect(px4Handler.decodeFlightMode(packed(MAIN.AUTO, SUB_AUTO.RTL))).toBe("RTL");
  });

  it("decodes an unknown custom_mode to UNKNOWN", () => {
    expect(px4Handler.decodeFlightMode(packed(0x0f, 0x0f))).toBe("UNKNOWN");
  });

  it("createPX4Handler yields the same packing for a plane class", () => {
    const plane = createPX4Handler("plane");
    expect(plane.encodeFlightMode("MISSION").customMode).toBe(
      packed(MAIN.AUTO, SUB_AUTO.MISSION),
    );
  });
});

describe("PX4 mode table", () => {
  // Every (main, sub) pair a PX4 vehicle reports in HEARTBEAT custom_mode.
  // AUTO sub 7 is reserved, AUTO sub 10 is VTOL takeoff and
  // POSCTL sub 1 is ORBIT.
  const PX4_TABLE: ReadonlyArray<[UnifiedFlightMode, number, number]> = [
    ["MANUAL", 1, 0],
    ["ALT_HOLD", 2, 0],
    ["POSHOLD", 3, 0],
    ["ORBIT", 3, 1],
    ["MISSION", 4, 4],
    ["LOITER", 4, 3],
    ["RTL", 4, 5],
    ["LAND", 4, 6],
    ["TAKEOFF", 4, 2],
    ["READY", 4, 1],
    ["FOLLOW_ME", 4, 8],
    ["PRECLAND", 4, 9],
    ["VTOL_TAKEOFF", 4, 10],
    ["ACRO", 5, 0],
    ["OFFBOARD", 6, 0],
    ["STABILIZE", 7, 0],
  ];

  it.each(PX4_TABLE)("encodes %s as main %i sub %i", (mode, main, sub) => {
    expect(px4Handler.encodeFlightMode(mode).customMode).toBe(packed(main, sub));
  });

  it.each(PX4_TABLE.filter(([m]) => m !== "MISSION"))(
    "decodes %s from main %i sub %i",
    (mode, main, sub) => {
      expect(px4Handler.decodeFlightMode(packed(main, sub))).toBe(mode);
    },
  );

  it("never commands the reserved AUTO sub-mode 7", () => {
    for (const mode of createPX4Handler("vtol").getAvailableModes()) {
      const { customMode } = px4Handler.encodeFlightMode(mode);
      expect(customMode).not.toBe(packed(MAIN.AUTO, 7));
    }
  });

  it("offers VTOL takeoff only to a VTOL", () => {
    expect(createPX4Handler("vtol").getAvailableModes()).toContain("VTOL_TAKEOFF");
    expect(createPX4Handler("copter").getAvailableModes()).not.toContain("VTOL_TAKEOFF");
  });
});

describe("PX4 vehicle-class classification from HEARTBEAT", () => {
  it("classifies a PX4 fixed-wing as a plane, not a copter", () => {
    expect(createFirmwareHandler(PX4, MAV_TYPE_FIXED_WING).vehicleClass).toBe("plane");
  });

  it("classifies a PX4 VTOL as a vtol", () => {
    expect(createFirmwareHandler(PX4, MAV_TYPE_VTOL_TILTROTOR).vehicleClass).toBe("vtol");
  });

  it("classifies a PX4 multirotor as a copter", () => {
    expect(createFirmwareHandler(PX4, MAV_TYPE_QUADROTOR).vehicleClass).toBe("copter");
  });
});

describe("PX4 supported mission commands", () => {
  it("excludes NAV_SPLINE_WAYPOINT (82, ArduPilot-only)", () => {
    const cmds = createPX4Handler("copter").getSupportedMissionCommands?.() ?? [];
    expect(cmds).not.toContain(82); // spline is ArduPilot-only
    expect(cmds).toContain(16); // NAV_WAYPOINT
    expect(cmds).toContain(93); // NAV_DELAY (was mislabeled as 82)
    expect(cmds).toContain(94); // NAV_PAYLOAD_PLACE
  });

  it("adds the VTOL commands for a plane/VTOL, not a copter", () => {
    const copter = createPX4Handler("copter").getSupportedMissionCommands?.() ?? [];
    const plane = createPX4Handler("plane").getSupportedMissionCommands?.() ?? [];
    expect(copter).not.toContain(84); // NAV_VTOL_TAKEOFF
    expect(plane).toContain(84); // NAV_VTOL_TAKEOFF
    expect(plane).toContain(85); // NAV_VTOL_LAND
    expect(plane).toContain(189); // DO_LAND_START
  });
});
