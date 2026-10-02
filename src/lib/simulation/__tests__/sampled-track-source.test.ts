import { describe, expect, it } from "vitest";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan, interpolatePosition } from "@/lib/simulation-utils";
import { makeKinematicTrackSource } from "@/lib/simulation/sampled-track-source";

// Single eastbound leg at the equator, climbing 100m -> 200m. Linear-in-time
// interpolation makes the midpoint predictable (lon ~1.5, alt ~150). The leg
// stays off 0/0, which marks an item saved without a position.
const leg: Waypoint[] = [
  { id: "wp-1", lat: 0, lon: 1, alt: 100 },
  { id: "wp-2", lat: 0, lon: 2, alt: 200 },
];

describe("makeKinematicTrackSource", () => {
  it("reports the kinematic tier and default id", () => {
    const src = makeKinematicTrackSource(leg, 15);
    expect(src.sourceTier).toBe("kinematic");
    expect(src.id).toBe("kinematic");
  });

  it("passes a custom id through", () => {
    const src = makeKinematicTrackSource(leg, 15, "planned-a");
    expect(src.id).toBe("planned-a");
  });

  it("duration equals the flight plan total duration", () => {
    const src = makeKinematicTrackSource(leg, 15);
    const expected = computeFlightPlan(leg, 15).totalDuration;
    expect(src.duration).toBe(expected);
    expect(src.duration).toBeGreaterThan(0);
  });

  it("sampleAt(0) is the first waypoint", () => {
    const src = makeKinematicTrackSource(leg, 15);
    const s = src.sampleAt(0);
    expect(s).not.toBeNull();
    expect(s!.lat).toBeCloseTo(0, 9);
    expect(s!.lon).toBeCloseTo(1, 9);
    expect(s!.alt).toBeCloseTo(100, 9);
    // Heading of the first segment (due east) and stationary at the start.
    expect(s!.headingDeg).toBeCloseTo(90, 3);
    expect(s!.speedMps).toBe(0);
  });

  it("sampleAt(duration) is the last waypoint", () => {
    const src = makeKinematicTrackSource(leg, 15);
    const s = src.sampleAt(src.duration);
    expect(s).not.toBeNull();
    expect(s!.lat).toBeCloseTo(0, 9);
    expect(s!.lon).toBeCloseTo(2, 9);
    expect(s!.alt).toBeCloseTo(200, 9);
  });

  it("interpolates mid-leg at half duration", () => {
    const speed = 15;
    const src = makeKinematicTrackSource(leg, speed);
    const s = src.sampleAt(src.duration / 2);
    expect(s).not.toBeNull();
    expect(s!.lon).toBeCloseTo(1.5, 6);
    expect(s!.alt).toBeCloseTo(150, 6);
    expect(s!.lat).toBeCloseTo(0, 9);
    expect(s!.speedMps).toBe(speed);
  });

  it("clamps before the start and after the end", () => {
    const src = makeKinematicTrackSource(leg, 15);
    const before = src.sampleAt(-10);
    const after = src.sampleAt(src.duration + 999);
    expect(before!.lon).toBeCloseTo(1, 9);
    expect(after!.lon).toBeCloseTo(2, 9);
  });

  it("stays byte-identical to the underlying flight-plan interpolation", () => {
    const src = makeKinematicTrackSource(leg, 15);
    const flightPlan = computeFlightPlan(leg, 15);
    for (const t of [0, src.duration * 0.13, src.duration * 0.5, src.duration * 0.87, src.duration]) {
      const s = src.sampleAt(t)!;
      const ref = interpolatePosition(flightPlan.segments, leg, t);
      expect(s.lat).toBe(ref.lat);
      expect(s.lon).toBe(ref.lon);
      expect(s.alt).toBe(ref.alt);
      expect(s.headingDeg).toBe(ref.heading);
      expect(s.speedMps).toBe(ref.speed);
    }
  });

  it("returns null and zero duration for an empty path", () => {
    const src = makeKinematicTrackSource([], 15);
    expect(src.duration).toBe(0);
    expect(src.sampleAt(0)).toBeNull();
    expect(src.sampleAt(5)).toBeNull();
  });

  it("honors per-waypoint speed and hold-time overrides", () => {
    const held: Waypoint[] = [
      { id: "a", lat: 0, lon: 1, alt: 50, holdTime: 4 },
      { id: "b", lat: 0, lon: 1.001, alt: 50, speed: 5 },
    ];
    const src = makeKinematicTrackSource(held, 20);
    // While holding at the first waypoint, position is pinned and speed is 0.
    const duringHold = src.sampleAt(2)!;
    expect(duringHold.lon).toBeCloseTo(1, 9);
    expect(duringHold.speedMps).toBe(0);
    // The override speed is what drives the leg once travel begins.
    const ref = computeFlightPlan(held, 20);
    expect(ref.segments[0].speed).toBe(5);
  });
});
