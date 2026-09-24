/**
 * @license GPL-3.0-only
 *
 * A leg that crosses the 180th meridian is a short hop, not a trip round the
 * world: interpolated points and the point-to-segment distance must take the
 * short way.
 */

import { describe, expect, it } from "vitest";

import { interpolateLatLon, pointToSegmentM } from "../distance";
import { computeTriggerPoints } from "@/lib/simulation/mission-action-state";
import { rotateMission, scaleMission } from "@/lib/transforms/mission-transforms";
import type { Waypoint } from "@/lib/types";

describe("interpolateLatLon across the antimeridian", () => {
  it("puts the midpoint of 179.9E -> 179.9W on the meridian, not at 0", () => {
    const mid = interpolateLatLon(-17, 179.9, -17, -179.9, 0.5);
    expect(Math.abs(Math.abs(mid.lon) - 180)).toBeLessThan(1e-9);
    expect(mid.lat).toBeCloseTo(-17, 9);
  });

  it("keeps an ordinary leg a plain linear interpolation", () => {
    expect(interpolateLatLon(10, 20, 12, 24, 0.25)).toEqual({ lat: 10.5, lon: 21 });
  });

  it("normalises a crossing point back into [-180, 180)", () => {
    const p = interpolateLatLon(0, 179, 0, -179, 0.75);
    expect(p.lon).toBeCloseTo(-179.5, 9);
  });
});

describe("pointToSegmentM across the antimeridian", () => {
  it("measures a point on a crossing fence edge as on the edge", () => {
    const d = pointToSegmentM([-17, 180], [-17, 179.99], [-17, -179.99]);
    expect(d).toBeLessThan(1);
  });
});

describe("computeTriggerPoints across the antimeridian", () => {
  it("places distance triggers along the short crossing leg", () => {
    const wp = (lon: number, actions?: Waypoint["actions"]): Waypoint =>
      ({ lat: -17, lon, alt: 50, actions }) as Waypoint;
    const points = computeTriggerPoints([
      wp(179.999, [{ command: "DO_SET_CAM_TRIGG", param1: 50 }] as Waypoint["actions"]),
      wp(-179.999),
    ]);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      expect(Math.abs(p.lon)).toBeGreaterThan(179.99);
    }
  });
});


describe("mission transforms across the antimeridian", () => {
  const straddling = [
    { lat: -17, lon: 179.99 },
    { lat: -17, lon: -179.99 },
  ] as Waypoint[];

  it("rotates a straddling mission about its real centre", () => {
    for (const p of rotateMission(straddling, 90)) {
      expect(Math.abs(p.lon)).toBeGreaterThan(179.9);
      expect(Math.abs(p.lat + 17)).toBeLessThan(0.02);
    }
  });

  it("scales a straddling mission without flinging it round the globe", () => {
    const [a, b] = scaleMission(straddling, 2);
    expect(a.lon).toBeCloseTo(179.98, 6);
    expect(b.lon).toBeCloseTo(-179.98, 6);
  });
});