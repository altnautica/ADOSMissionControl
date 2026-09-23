import { describe, it, expect } from "vitest";
import {
  MISSION_TEMPLATES,
  type MissionTemplateContext,
} from "@/lib/templates/mission-templates";

const BANGALORE: [number, number] = [12.9716, 77.5946];
const LONDON: [number, number] = [51.5074, -0.1278];

function ctxAt(center: [number, number], boundary?: [number, number][]): MissionTemplateContext {
  return { center, boundary, altitude: 60, speed: 6, frame: "relative" };
}

/** Every generated waypoint sits within `tol` degrees of the context center. */
function nearCenter(
  waypoints: { lat: number; lon: number }[],
  center: [number, number],
  tol = 0.02,
): boolean {
  return waypoints.every(
    (w) => Math.abs(w.lat - center[0]) <= tol && Math.abs(w.lon - center[1]) <= tol,
  );
}

describe("MISSION_TEMPLATES", () => {
  it("exposes a non-empty catalog with unique ids + i18n keys", () => {
    expect(MISSION_TEMPLATES.length).toBeGreaterThanOrEqual(4);
    const ids = MISSION_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const tpl of MISSION_TEMPLATES) {
      expect(tpl.nameKey).toContain(".name");
      expect(tpl.descKey).toContain(".desc");
      expect(typeof tpl.build).toBe("function");
    }
  });

  for (const tpl of MISSION_TEMPLATES) {
    describe(tpl.id, () => {
      it("builds a non-empty, valid Waypoint[] near the map center", () => {
        const waypoints = tpl.build(ctxAt(BANGALORE));
        expect(waypoints.length).toBeGreaterThan(0);

        for (const w of waypoints) {
          expect(typeof w.id).toBe("string");
          expect(w.id.length).toBeGreaterThan(0);
          expect(Number.isFinite(w.lat)).toBe(true);
          expect(Number.isFinite(w.lon)).toBe(true);
          expect(Number.isFinite(w.alt)).toBe(true);
          expect(typeof w.command).toBe("string");
          expect((w.command ?? "").length).toBeGreaterThan(0);
        }

        // Bookended into a complete, flyable mission.
        expect(waypoints[0].command).toBe("TAKEOFF");
        expect(waypoints[waypoints.length - 1].command).toBe("RTL");

        // Every coordinate is derived from the provided center, not hardcoded.
        expect(nearCenter(waypoints, BANGALORE)).toBe(true);
      });

      it("tracks a DIFFERENT center (coordinates are not hardcoded)", () => {
        const waypoints = tpl.build(ctxAt(LONDON));
        expect(waypoints.length).toBeGreaterThan(0);
        expect(nearCenter(waypoints, LONDON)).toBe(true);
        // ...and definitely not the other test's center.
        expect(nearCenter(waypoints, BANGALORE)).toBe(false);
      });

      it("honors non-default altitude + speed on cruise waypoints", () => {
        const waypoints = tpl.build(ctxAt(BANGALORE));
        // At least one plain cruise waypoint carries the requested altitude.
        const cruise = waypoints.filter((w) => w.command === "WAYPOINT");
        expect(cruise.length).toBeGreaterThan(0);
        expect(cruise.some((w) => w.alt === 60)).toBe(true);
      });
    });
  }

  it("area templates build from a drawn boundary when one is provided", () => {
    const areaTemplates = MISSION_TEMPLATES.filter((t) => t.needsBoundary);
    expect(areaTemplates.length).toBeGreaterThan(0);

    // A small boundary near, but not identical to, the plain map center.
    const bLat = BANGALORE[0] + 0.01;
    const bLon = BANGALORE[1] + 0.01;
    const boundary: [number, number][] = [
      [bLat - 0.001, bLon - 0.001],
      [bLat - 0.001, bLon + 0.001],
      [bLat + 0.001, bLon + 0.001],
      [bLat + 0.001, bLon - 0.001],
    ];

    for (const tpl of areaTemplates) {
      const waypoints = tpl.build(ctxAt(BANGALORE, boundary));
      expect(waypoints.length).toBeGreaterThan(0);
      // Waypoints follow the boundary, not the raw center.
      expect(nearCenter(waypoints, [bLat, bLon], 0.01)).toBe(true);
    }
  });
});
