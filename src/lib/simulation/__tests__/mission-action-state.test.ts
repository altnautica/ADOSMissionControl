import { describe, it, expect } from "vitest";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { patternToMission } from "@/lib/patterns/pattern-to-mission";
import {
  computeTriggerPoints,
  hasDepictedActions,
  legActionStates,
} from "@/lib/simulation/mission-action-state";
import type { Waypoint } from "@/lib/types";

/** A survey applied the way the planner applies it: actions folded onto nav waypoints. */
function appliedSurvey(triggerDistance: number): Waypoint[] {
  const result = generateSurvey({
    polygon: [
      [12.97, 77.59],
      [12.97, 77.6],
      [12.98, 77.6],
      [12.98, 77.59],
    ],
    gridAngle: 0,
    lineSpacing: 100,
    turnAroundDistance: 10,
    entryLocation: "topLeft",
    flyAlternateTransects: false,
    cameraTriggerDistance: triggerDistance,
    altitude: 50,
    speed: 5,
  });
  return patternToMission(result.waypoints, "relative");
}

describe("mission action state", () => {
  it("finds distance triggers in a pattern-applied survey whose camera commands live in actions", () => {
    const mission = appliedSurvey(10);
    // The planner model keeps camera commands as actions, never as the nav command.
    expect(mission.some((wp) => wp.command === "DO_SET_CAM_TRIGG")).toBe(false);
    expect(mission.some((wp) => wp.actions?.some((a) => a.command === "DO_SET_CAM_TRIGG"))).toBe(true);

    expect(hasDepictedActions(mission)).toBe(true);
    expect(computeTriggerPoints(mission).length).toBeGreaterThan(0);
    expect(legActionStates(mission).some((s) => s.camTriggerActive)).toBe(true);
  });

  it("stops triggering after DO_SET_CAM_TRIGG with distance 0", () => {
    const wp = (id: string, lon: number, actions?: Waypoint["actions"]): Waypoint => ({
      id, lat: 0, lon, alt: 50, command: "WAYPOINT", actions,
    });
    const mission = [
      wp("a", 0, [{ id: "t1", command: "DO_SET_CAM_TRIGG", param1: 100 }]),
      wp("b", 0.01, [{ id: "t0", command: "DO_SET_CAM_TRIGG", param1: 0 }]),
      wp("c", 0.02),
    ];
    // Leg a->b is ~1113 m: 11 triggers at 100 m; leg b->c is off.
    expect(computeTriggerPoints(mission)).toHaveLength(11);
    expect(legActionStates(mission).map((s) => s.camTriggerActive)).toEqual([true, false, false]);
  });

  it("places a DO_DIGICAM shot at its waypoint and tracks ROI set and clear", () => {
    const mission: Waypoint[] = [
      { id: "a", lat: 1, lon: 2, alt: 30, actions: [{ id: "r", command: "ROI", lat: 1, lon: 2, alt: 0 }] },
      { id: "b", lat: 1.001, lon: 2, alt: 40, actions: [{ id: "d", command: "DO_DIGICAM" }] },
      { id: "c", lat: 1.002, lon: 2, alt: 40, actions: [{ id: "n", command: "DO_SET_ROI_NONE" }] },
    ];
    expect(computeTriggerPoints(mission)).toEqual([{ lat: 1.001, lon: 2, alt: 40 }]);
    expect(legActionStates(mission).map((s) => s.roiActive)).toEqual([true, true, false]);
  });
});
