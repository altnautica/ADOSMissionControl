import { describe, it, expect } from "vitest";
import {
  cumulativeGroundDistances,
  altitudeRange,
  linearScale,
} from "@/lib/altitude-profile";
import type { Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";

function wp(id: string, lat: number, lon: number, alt: number): Waypoint {
  return { id, lat, lon, alt };
}

describe("cumulativeGroundDistances", () => {
  it("returns an empty array for no waypoints", () => {
    expect(cumulativeGroundDistances([])).toEqual([]);
  });

  it("starts at zero for the first waypoint", () => {
    const dists = cumulativeGroundDistances([wp("a", 12.95, 77.668, 50)]);
    expect(dists).toEqual([0]);
  });

  it("accumulates great-circle distance leg by leg", () => {
    const a = wp("a", 12.95, 77.668, 50);
    const b = wp("b", 12.96, 77.668, 50);
    const c = wp("c", 12.96, 77.678, 50);
    const dists = cumulativeGroundDistances([a, b, c]);

    const legAB = haversineDistance(a.lat, a.lon, b.lat, b.lon);
    const legBC = haversineDistance(b.lat, b.lon, c.lat, c.lon);

    expect(dists[0]).toBe(0);
    expect(dists[1]).toBeCloseTo(legAB, 6);
    expect(dists[2]).toBeCloseTo(legAB + legBC, 6);
  });

  it("is monotonically non-decreasing", () => {
    const dists = cumulativeGroundDistances([
      wp("a", 12.95, 77.66, 0),
      wp("b", 12.97, 77.67, 0),
      wp("c", 12.99, 77.69, 0),
    ]);
    for (let i = 1; i < dists.length; i++) {
      expect(dists[i]).toBeGreaterThanOrEqual(dists[i - 1]);
    }
  });
});

describe("altitudeRange", () => {
  it("returns a default range when empty", () => {
    expect(altitudeRange([])).toEqual({ minAlt: 0, maxAlt: 100 });
  });

  it("pads the span by 15% on each side", () => {
    // span = 100, pad = 15
    const { minAlt, maxAlt } = altitudeRange([50, 150]);
    expect(minAlt).toBe(35);
    expect(maxAlt).toBe(165);
  });

  it("floors the minimum at zero", () => {
    const { minAlt } = altitudeRange([5, 10]);
    expect(minAlt).toBe(0);
  });

  it("applies a 5m minimum pad for a flat profile", () => {
    const { minAlt, maxAlt } = altitudeRange([100, 100]);
    expect(minAlt).toBe(95);
    expect(maxAlt).toBe(105);
  });
});

describe("linearScale", () => {
  it("maps the domain endpoints onto the range endpoints", () => {
    const s = linearScale(0, 100, 0, 200);
    expect(s(0)).toBe(0);
    expect(s(50)).toBe(100);
    expect(s(100)).toBe(200);
  });

  it("offsets the range by rangeStart", () => {
    const s = linearScale(0, 10, 28, 264);
    expect(s(0)).toBe(28);
    expect(s(10)).toBe(28 + 264);
  });

  it("inverts the range when requested (higher value -> smaller pixel)", () => {
    const s = linearScale(0, 100, 6, 60, true);
    expect(s(0)).toBe(6 + 60); // min value -> bottom
    expect(s(100)).toBe(6); // max value -> top
    expect(s(50)).toBe(6 + 30);
  });

  it("maps everything to the range start for a zero-width domain", () => {
    const s = linearScale(42, 42, 10, 100);
    expect(s(42)).toBe(10);
    expect(s(999)).toBe(10);
  });
});
