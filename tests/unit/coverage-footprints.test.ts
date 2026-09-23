/**
 * Coverage footprint geometry: captures fall every trigger distance along the
 * legs the camera is armed on, each footprint is sized for its own altitude and
 * oriented along its leg. Empty/degenerate inputs produce no footprints (never a
 * fabricated coverage claim).
 * @license GPL-3.0-only
 */
import { describe, it, expect } from "vitest";
import {
  buildFootprintPolygon, buildFootprintPolygons, sampleCapturePoints, type CaptureRouteRow,
} from "@/lib/patterns/coverage-footprints";
import type { CameraProfile } from "@/lib/patterns/gsd-calculator";
import { haversineDistance } from "@/lib/geo/distance";

const CAMERA: CameraProfile = {
  name: "Test",
  sensorWidth: 17.3,
  sensorHeight: 13.0,
  focalLength: 12.29,
  imageWidth: 5280,
  imageHeight: 3956,
};

describe("buildFootprintPolygon", () => {
  it("returns four corners centred on the point", () => {
    const poly = buildFootprintPolygon(12.5, 77.5, 0, 100, 60);
    expect(poly).toHaveLength(4);
    // The centroid of the four corners is (approximately) the input point.
    const cLat = poly.reduce((s, p) => s + p[0], 0) / 4;
    const cLon = poly.reduce((s, p) => s + p[1], 0) / 4;
    expect(cLat).toBeCloseTo(12.5, 4);
    expect(cLon).toBeCloseTo(77.5, 4);
  });

  it("grows with a larger footprint", () => {
    const small = buildFootprintPolygon(0, 0, 0, 20, 20);
    const big = buildFootprintPolygon(0, 0, 0, 200, 200);
    const span = (p: [number, number][]) => Math.max(...p.map((c) => c[0])) - Math.min(...p.map((c) => c[0]));
    expect(span(big)).toBeGreaterThan(span(small));
  });
});

/** One survey transect as the generator emits it: start, trigger on, end, trigger off. */
function transect(start: [number, number], end: [number, number], alt: number, spacing: number): CaptureRouteRow[] {
  return [
    { lat: start[0], lon: start[1], alt, command: "WAYPOINT" },
    { lat: start[0], lon: start[1], alt, command: "DO_SET_CAM_TRIGG", param1: spacing },
    { lat: end[0], lon: end[1], alt, command: "WAYPOINT" },
    { lat: end[0], lon: end[1], alt, command: "DO_SET_CAM_TRIGG", param1: 0 },
  ];
}

describe("sampleCapturePoints", () => {
  // ~1112 m due north.
  const leg = transect([12.5, 77.5], [12.51, 77.5], 60, 100);

  it("places a capture every trigger distance along the armed leg, not only at its ends", () => {
    const { points, total } = sampleCapturePoints(leg);
    const legM = haversineDistance(12.5, 77.5, 12.51, 77.5);
    expect(total).toBe(Math.floor(legM / 100) + 1);
    expect(points).toHaveLength(total);
    for (let i = 1; i < points.length; i++) {
      expect(haversineDistance(points[i - 1].lat, points[i - 1].lon, points[i].lat, points[i].lon)).toBeCloseTo(100, 0);
    }
    expect(points[0]).toMatchObject({ lat: 12.5, lon: 77.5, alt: 60 });
    expect(points[0].headingDeg).toBeCloseTo(0, 3);
  });

  it("takes no captures on the unarmed turn between transects", () => {
    const route = [...leg, ...transect([12.51, 77.501], [12.5, 77.501], 60, 100)];
    const one = sampleCapturePoints(leg).total;
    const { points, total } = sampleCapturePoints(route);
    expect(total).toBe(2 * one);
    // Nothing lands between the two transects' longitudes.
    expect(points.every((p) => p.lon === 77.5 || p.lon === 77.501)).toBe(true);
  });

  it("interpolates each capture's altitude along its leg", () => {
    const climbing: CaptureRouteRow[] = [
      { lat: 12.5, lon: 77.5, alt: 40, command: "WAYPOINT" },
      { lat: 12.5, lon: 77.5, alt: 40, command: "DO_SET_CAM_TRIGG", param1: 100 },
      { lat: 12.51, lon: 77.5, alt: 80, command: "WAYPOINT" },
    ];
    const { points } = sampleCapturePoints(climbing);
    expect(points[0].alt).toBe(40);
    expect(points[points.length - 1].alt).toBeGreaterThan(75);
  });

  it("caps the built points but reports the full count", () => {
    const { points, total } = sampleCapturePoints(leg, 3);
    expect(points).toHaveLength(3);
    expect(total).toBe(sampleCapturePoints(leg).total);
  });

  it("returns nothing for a route with no camera trigger", () => {
    const route: CaptureRouteRow[] = [
      { lat: 12.5, lon: 77.5, alt: 50, command: "WAYPOINT" },
      { lat: 12.51, lon: 77.5, alt: 50, command: "WAYPOINT" },
    ];
    expect(sampleCapturePoints(route)).toEqual({ points: [], total: 0 });
  });
});

describe("buildFootprintPolygons", () => {
  const points = [
    { lat: 12.5, lon: 77.5, alt: 50, headingDeg: 0 },
    { lat: 12.51, lon: 77.5, alt: 100, headingDeg: 0 },
  ];
  const span = (p: [number, number][]) => Math.max(...p.map((c) => c[1])) - Math.min(...p.map((c) => c[1]));

  it("builds one footprint per capture, sized for that capture's altitude", () => {
    const polys = buildFootprintPolygons(points, CAMERA);
    expect(polys).toHaveLength(2);
    for (const p of polys) expect(p).toHaveLength(4);
    expect(span(polys[1])).toBeCloseTo(span(polys[0]) * 2, 6);
  });

  it("returns nothing for no captures", () => {
    expect(buildFootprintPolygons([], CAMERA)).toEqual([]);
  });

  it("skips captures with a non-positive altitude (no fabricated footprint)", () => {
    expect(buildFootprintPolygons([{ ...points[0], alt: 0 }, { ...points[0], alt: NaN }], CAMERA)).toEqual([]);
  });
});
