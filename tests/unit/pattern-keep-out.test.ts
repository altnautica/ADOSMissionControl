/**
 * Generated patterns keep clear of what they must avoid: survey legs never cut
 * through a keep-out hole, and a structure-scan orbit stays outside the
 * structure.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { generateSurvey } from "@/lib/patterns/survey-generator";
import { generateStructureScan } from "@/lib/patterns/structure-scan-generator";
import { haversineDistance, pointInPolygon } from "@/lib/geo/distance";

const BOUNDARY: [number, number][] = [
  [12.970, 77.590], [12.970, 77.596], [12.976, 77.596], [12.976, 77.590],
];
const HOLE: [number, number][] = [
  [12.972, 77.592], [12.972, 77.594], [12.974, 77.594], [12.974, 77.592],
];

/** Shrink a ring toward its centroid so points on its edge fall outside. */
function inset(ring: [number, number][], frac: number): [number, number][] {
  const cLat = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cLon = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([lat, lon]) => [lat + (cLat - lat) * frac, lon + (cLon - lon) * frac]);
}

describe("survey legs around a keep-out hole", () => {
  it("no leg between consecutive waypoints passes through the hole", () => {
    const result = generateSurvey({
      polygon: BOUNDARY, gridAngle: 0, lineSpacing: 50, turnAroundDistance: 0,
      entryLocation: "topLeft", flyAlternateTransects: false, cameraTriggerDistance: 0,
      altitude: 50, speed: 5, exclusions: [HOLE],
    });
    const nav = result.waypoints.filter((w) => w.command === "WAYPOINT");
    const core = inset(HOLE, 0.05);
    for (let i = 1; i < nav.length; i++) {
      for (let t = 0.05; t < 1; t += 0.05) {
        const p: [number, number] = [
          nav[i - 1].lat + (nav[i].lat - nav[i - 1].lat) * t,
          nav[i - 1].lon + (nav[i].lon - nav[i - 1].lon) * t,
        ];
        expect(pointInPolygon(p, core)).toBe(false);
      }
    }
  });

  it("switches the camera on and off at the boundary, not at the overshoot", () => {
    const result = generateSurvey({
      polygon: BOUNDARY, gridAngle: 0, lineSpacing: 100, turnAroundDistance: 40,
      entryLocation: "topLeft", flyAlternateTransects: false, cameraTriggerDistance: 20,
      altitude: 50, speed: 5,
    });
    const edges = (result.previewLines ?? []).flat();
    const triggers = result.waypoints.filter((w) => w.command === "DO_SET_CAM_TRIGG");
    expect(triggers.length).toBeGreaterThan(0);
    for (const tr of triggers) {
      const nearest = Math.min(...edges.map(([lat, lon]) => haversineDistance(tr.lat, tr.lon, lat, lon)));
      expect(nearest).toBeLessThan(0.5);
    }
  });
});

describe("structure scan orbit", () => {
  it("keeps every orbit point at least the scan distance from an elongated footprint", () => {
    // A ~100 x 10 m building digitised with extra points along its long sides.
    const lat0 = 12.97;
    const lon0 = 77.59;
    const dLon = 50 / (111320 * Math.cos((lat0 * Math.PI) / 180));
    const dLat = 5 / 111320;
    const footprint: [number, number][] = [
      [lat0 - dLat, lon0 - dLon], [lat0 - dLat, lon0 - dLon / 2], [lat0 - dLat, lon0], [lat0 - dLat, lon0 + dLon / 2],
      [lat0 - dLat, lon0 + dLon], [lat0 + dLat, lon0 + dLon], [lat0 + dLat, lon0 + dLon / 2], [lat0 + dLat, lon0],
      [lat0 + dLat, lon0 - dLon / 2], [lat0 + dLat, lon0 - dLon],
    ];
    const scanDistance = 15;
    const result = generateStructureScan({
      structurePolygon: footprint, bottomAlt: 10, topAlt: 10, layerSpacing: 10, scanDistance,
      gimbalPitch: 0, pointsPerLayer: 8, cameraTriggerDistance: 0, speed: 3, direction: "bottom-up",
    });
    const orbit = result.waypoints.filter((w) => w.command === "WAYPOINT");
    expect(orbit.length).toBe(8);
    for (const pt of orbit) {
      const nearest = Math.min(...footprint.map(([lat, lon]) => haversineDistance(pt.lat, pt.lon, lat, lon)));
      expect(nearest).toBeGreaterThanOrEqual(scanDistance - 0.5);
    }
  });
});
