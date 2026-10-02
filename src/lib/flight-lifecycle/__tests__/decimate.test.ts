/**
 * Stored flight paths: a long flight is thinned evenly over its whole length,
 * never cut off, and the first and last fixes always survive.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";

import { decimatePath, MAX_PATH_POINTS } from "../decimate";
import { computeFlightStats } from "../stats";
import type { TelemetryFrame } from "../../telemetry-recorder";

describe("decimatePath", () => {
  it("keeps the first and last point and spreads the rest over the whole list", () => {
    const points = Array.from({ length: 10_001 }, (_, i) => i);
    const out = decimatePath(points, 1000);
    expect(out).toHaveLength(1000);
    expect(out[0]).toBe(0);
    expect(out[out.length - 1]).toBe(10_000);
    expect(out[500]).toBeGreaterThan(4900);
    expect(out[500]).toBeLessThan(5100);
  });

  it("returns a list already within the limit unchanged", () => {
    const points = [1, 2, 3];
    expect(decimatePath(points, 1000)).toBe(points);
  });
});

describe("flight path of a long flight", () => {
  it("covers the whole flight and ends at the landing fix, while analysis sees every fix", () => {
    // 40 minutes at 1 Hz heading north.
    const frames: TelemetryFrame[] = Array.from({ length: 2400 }, (_, s) => ({
      offsetMs: s * 1000,
      channel: "globalPosition",
      data: { lat: 12 + s * 1e-5, lon: 77, relativeAlt: 30 },
    }));
    const stats = computeFlightStats(frames);
    expect(stats.path.length).toBeLessThanOrEqual(MAX_PATH_POINTS);
    expect(stats.path[0]).toEqual([12, 77]);
    expect(stats.path[stats.path.length - 1]).toEqual([12 + 2399e-5, 77]);
    expect([stats.landingLat, stats.landingLon]).toEqual([12 + 2399e-5, 77]);
    expect(stats.track).toHaveLength(2400);
  });
});
