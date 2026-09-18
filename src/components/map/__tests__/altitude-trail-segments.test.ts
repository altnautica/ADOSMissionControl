/**
 * The altitude trail must not create one Leaflet layer per telemetry sample.
 *
 * `altitudeColor` interpolated continuously, so two samples a few centimetres
 * apart produced different `rgb(...)` strings, the "same colour as the last
 * point?" test never held, and every point became its own `<Polyline>` plus
 * `<Tooltip>`. A 2000-point trail meant ~2000 live layers, each re-projected
 * on every pan and zoom. Quantising into bands bounds the segment count.
 */

import { describe, it, expect } from "vitest";

import { buildSegments } from "@/components/map/AltitudeTrail";
import type { TrailPoint } from "@/stores/trail-store";

function pt(alt: number, i: number): TrailPoint {
  return { lat: 12.9 + i * 1e-5, lon: 77.6 + i * 1e-5, alt };
}

describe("altitude trail segmentation", () => {
  it("keeps level flight to a single segment despite float noise", () => {
    // Real telemetry: a hover at 30 m jitters by centimetres every sample.
    const trail = Array.from({ length: 500 }, (_, i) =>
      pt(30 + Math.sin(i) * 0.05, i),
    );
    expect(buildSegments(trail)).toHaveLength(1);
  });

  it("bounds the segment count for a full-range climb", () => {
    // One sample per 6 cm from ground to ceiling: 2000 points. Before
    // quantisation this produced on the order of 2000 segments.
    const trail = Array.from({ length: 2000 }, (_, i) => pt((i / 2000) * 120, i));
    const segments = buildSegments(trail);
    expect(segments.length).toBeLessThanOrEqual(16);
    expect(segments.length).toBeGreaterThan(1);
  });

  it("still splits where the displayed colour genuinely changes", () => {
    const trail = [...Array.from({ length: 20 }, (_, i) => pt(5, i)),
      ...Array.from({ length: 20 }, (_, i) => pt(110, 20 + i))];
    const segments = buildSegments(trail);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0].color).not.toBe(segments[segments.length - 1].color);
  });

  it("joins consecutive segments so the drawn line has no gaps", () => {
    const trail = [...Array.from({ length: 5 }, (_, i) => pt(5, i)),
      ...Array.from({ length: 5 }, (_, i) => pt(110, 5 + i))];
    const segments = buildSegments(trail);
    for (let i = 1; i < segments.length; i++) {
      const prevEnd = segments[i - 1].positions.at(-1);
      expect(segments[i].positions[0]).toEqual(prevEnd);
    }
  });
});
