/**
 * @license GPL-3.0-only
 *
 * The vehicle flies the straight line between waypoints, so a leg that cuts
 * outside a concave fence or through a no-fly zone is blocking even when both
 * of its waypoints are on the right side.
 */

import { describe, expect, it } from "vitest";

import { validateMission } from "../mission-validator";
import type { Waypoint } from "@/lib/types";
import type { FenceZone } from "@/stores/geofence-store";

const wp = (id: string, lat: number, lon: number): Waypoint =>
  ({ id, lat, lon, alt: 30, command: "WAYPOINT" }) as Waypoint;

// An L-shaped inclusion fence: the notch is the square lat>0.001, lon>0.001.
const L_FENCE: [number, number][] = [
  [0, 0], [0, 0.002], [0.001, 0.002], [0.001, 0.001], [0.002, 0.001], [0.002, 0],
];

describe("leg fence crossing", () => {
  it("blocks a leg that cuts across the notch of a concave fence", () => {
    const result = validateMission(
      [wp("a", 0.0005, 0.0019), wp("b", 0.0019, 0.0005)],
      { geofence: { polygonPoints: L_FENCE } },
    );
    expect(result.errors.map((e) => e.code)).toContain("LEG_OUTSIDE_GEOFENCE");
  });

  it("blocks a leg that runs through a no-fly circle between two clear waypoints", () => {
    const zone: FenceZone = {
      id: "z", role: "exclusion", type: "circle",
      polygonPoints: [], circleCenter: [0, 0.001], circleRadius: 30,
    };
    const result = validateMission(
      [wp("a", 0, 0), wp("b", 0, 0.002)],
      { geofence: { zones: [zone] } },
    );
    expect(result.errors.map((e) => e.code)).toContain("LEG_CROSSES_EXCLUSION_ZONE");
  });

  it("passes a leg that stays inside the fence", () => {
    const result = validateMission(
      [wp("a", 0.0002, 0.0002), wp("b", 0.0018, 0.0002)],
      { geofence: { polygonPoints: L_FENCE } },
    );
    expect(result.errors.map((e) => e.code)).not.toContain("LEG_OUTSIDE_GEOFENCE");
  });
});
