import { describe, it, expect } from "vitest";
import {
  polygonArea,
  nearestVertexWithinThreshold,
} from "../geo-utils";
import { haversineDistance } from "@/lib/geo/distance";

describe("polygonArea", () => {
  it("returns the enclosed area of a known square (~side²)", () => {
    // A small square near the equator. The one edge length squared is the
    // expected planar area; the geodetic projection is accurate at this scale.
    const d = 0.01;
    const square: [number, number][] = [
      [0, 0],
      [0, d],
      [d, d],
      [d, 0],
    ];
    const side = haversineDistance(0, 0, 0, d); // ~1112 m
    const expected = side * side;
    const area = polygonArea(square);
    // Within 0.5% of the analytic square area.
    expect(area).toBeGreaterThan(expected * 0.995);
    expect(area).toBeLessThan(expected * 1.005);
  });

  it("is orientation-independent (returns absolute area)", () => {
    const cw: [number, number][] = [
      [0, 0],
      [0, 0.01],
      [0.01, 0.01],
      [0.01, 0],
    ];
    const ccw: [number, number][] = [...cw].reverse();
    expect(polygonArea(cw)).toBeCloseTo(polygonArea(ccw), 6);
  });

  it("returns 0 for fewer than 3 vertices", () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([[0, 0]])).toBe(0);
    expect(polygonArea([[0, 0], [0, 1]])).toBe(0);
  });
});

describe("nearestVertexWithinThreshold", () => {
  // A simple linear projection so pixel distances are predictable in tests.
  const toPixel = (ll: [number, number]) => ({ x: ll[1] * 1000, y: ll[0] * 1000 });

  it("snaps to a candidate within the pixel threshold", () => {
    const candidates: [number, number][] = [
      [0, 1], // 1000 px away — far
      [0, 0.01], // 10 px away — within 12
    ];
    const snapped = nearestVertexWithinThreshold([0, 0], candidates, toPixel, 12);
    expect(snapped).toEqual([0, 0.01]);
  });

  it("returns null when every candidate is beyond the threshold", () => {
    const candidates: [number, number][] = [
      [0, 1],
      [1, 0],
    ];
    expect(nearestVertexWithinThreshold([0, 0], candidates, toPixel, 12)).toBeNull();
  });

  it("returns null for an empty candidate list", () => {
    expect(nearestVertexWithinThreshold([0, 0], [], toPixel, 12)).toBeNull();
  });

  it("returns null for a non-positive threshold", () => {
    expect(nearestVertexWithinThreshold([0, 0], [[0, 0]], toPixel, 0)).toBeNull();
  });

  it("picks the nearest when several candidates are within range", () => {
    const candidates: [number, number][] = [
      [0, 0.009], // 9 px
      [0, 0.003], // 3 px — nearest
      [0, 0.006], // 6 px
    ];
    const snapped = nearestVertexWithinThreshold([0, 0], candidates, toPixel, 12);
    expect(snapped).toEqual([0, 0.003]);
  });

  it("includes a candidate sitting exactly at the threshold distance", () => {
    const candidates: [number, number][] = [[0, 0.012]]; // exactly 12 px
    expect(nearestVertexWithinThreshold([0, 0], candidates, toPixel, 12)).toEqual([0, 0.012]);
  });
});
