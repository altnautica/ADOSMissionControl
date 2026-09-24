/**
 * The planner's nav-command palette is filtered by the connected firmware's
 * supported mission commands, so PX4 no longer offers commands it rejects (the
 * ArduPilot-only spline waypoint) while ArduPilot/unknown firmware sees all.
 *
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import { NAV_COMMAND_OPTIONS } from "../../../src/components/planner/waypoint-constants";
import { cmdMap } from "../../../src/lib/mission/command-map";
import { createPX4Handler } from "../../../src/lib/protocol/firmware/px4";

/** The same predicate WaypointListItem applies to NAV_COMMAND_OPTIONS. */
function filterNav(supported: Set<number> | null, current: string) {
  if (!supported) return NAV_COMMAND_OPTIONS;
  return NAV_COMMAND_OPTIONS.filter(
    (o) => o.value === current || supported.has(cmdMap[o.value]),
  );
}

describe("planner nav-command firmware gate", () => {
  it("hides the ArduPilot-only spline waypoint on PX4, keeps the standard waypoint", () => {
    const supported = new Set(createPX4Handler("copter").getSupportedMissionCommands?.() ?? []);
    const values = filterNav(supported, "WAYPOINT").map((o) => o.value);
    expect(values).toContain("WAYPOINT");
    expect(values).not.toContain("SPLINE_WAYPOINT");
  });

  it("keeps the current command visible even when the firmware would not offer it", () => {
    const supported = new Set(createPX4Handler("copter").getSupportedMissionCommands?.() ?? []);
    // A waypoint already set to SPLINE (e.g. an imported ArduPilot plan) still
    // shows its value so the user can see and change it.
    const values = filterNav(supported, "SPLINE_WAYPOINT").map((o) => o.value);
    expect(values).toContain("SPLINE_WAYPOINT");
  });

  it("shows every nav command when the firmware imposes no restriction (null)", () => {
    expect(filterNav(null, "WAYPOINT")).toEqual(NAV_COMMAND_OPTIONS);
  });
});
