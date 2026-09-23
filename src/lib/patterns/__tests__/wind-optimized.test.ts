/**
 * @module patterns/__tests__/wind-optimized
 * @description Unit tests for wind-optimized survey line orientation.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  normalizeLineAxis,
  axisAngularDifference,
  gridAngleLineBearing,
  optimalLineBearing,
  windPenalty,
} from "../wind-optimized";
import { generateSurvey } from "../survey-generator";
import { bearing } from "@/lib/telemetry-utils";

describe("normalizeLineAxis", () => {
  it("keeps values already in [0, 180)", () => {
    expect(normalizeLineAxis(0)).toBe(0);
    expect(normalizeLineAxis(45)).toBe(45);
    expect(normalizeLineAxis(179)).toBe(179);
  });

  it("folds by 180 because a line is an axis", () => {
    expect(normalizeLineAxis(180)).toBe(0);
    expect(normalizeLineAxis(200)).toBe(20);
    expect(normalizeLineAxis(270)).toBe(90);
    expect(normalizeLineAxis(360)).toBe(0);
  });

  it("handles negatives", () => {
    expect(normalizeLineAxis(-10)).toBe(170);
    expect(normalizeLineAxis(-180)).toBe(0);
    expect(normalizeLineAxis(-270)).toBe(90);
  });

  it("returns 0 for non-finite input", () => {
    expect(normalizeLineAxis(NaN)).toBe(0);
    expect(normalizeLineAxis(Infinity)).toBe(0);
  });
});

describe("axisAngularDifference", () => {
  it("is 0 for parallel axes", () => {
    expect(axisAngularDifference(30, 30)).toBe(0);
    // 180 apart is the same axis.
    expect(axisAngularDifference(30, 210)).toBeCloseTo(0, 10);
  });

  it("is 90 for perpendicular axes", () => {
    expect(axisAngularDifference(0, 90)).toBe(90);
    expect(axisAngularDifference(45, 135)).toBe(90);
  });

  it("folds to the acute side (never exceeds 90)", () => {
    expect(axisAngularDifference(10, 170)).toBeCloseTo(20, 10);
    expect(axisAngularDifference(0, 270)).toBe(90);
    expect(axisAngularDifference(0, 359)).toBeCloseTo(1, 10);
  });

  it("is symmetric in its arguments", () => {
    expect(axisAngularDifference(20, 95)).toBeCloseTo(
      axisAngularDifference(95, 20),
      10,
    );
  });

  it("returns 0 for non-finite input", () => {
    expect(axisAngularDifference(NaN, 10)).toBe(0);
    expect(axisAngularDifference(10, Infinity)).toBe(0);
  });
});

describe("optimalLineBearing", () => {
  it("aligns the line bearing with the wind axis", () => {
    // Wind from north -> north-south lines.
    expect(optimalLineBearing(0)).toBe(0);
    // Wind from east -> east-west lines.
    expect(optimalLineBearing(90)).toBe(90);
    expect(optimalLineBearing(45)).toBe(45);
  });

  it("is invariant to the wind from/to convention", () => {
    // From 30 and from 210 are the same axis.
    expect(optimalLineBearing(30)).toBe(optimalLineBearing(210));
  });

  it("returns a value inside [0, 180)", () => {
    for (const w of [-400, -10, 0, 95, 180, 275, 360, 719]) {
      const b = optimalLineBearing(w);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(180);
    }
  });

  it("makes windPenalty zero at the optimal orientation", () => {
    for (const w of [0, 17, 90, 133, 250]) {
      const best = optimalLineBearing(w);
      expect(windPenalty(best, w, 8)).toBeCloseTo(0, 10);
    }
  });
});

describe("gridAngleLineBearing", () => {
  /** Compass bearing of the first transect the generator flies at this grid angle. */
  function flownLegBearing(gridAngle: number): number {
    const rows = generateSurvey({
      polygon: [[12.97, 77.59], [12.97, 77.6], [12.98, 77.6], [12.98, 77.59]],
      gridAngle, lineSpacing: 200, turnAroundDistance: 0, entryLocation: "topLeft",
      flyAlternateTransects: false, cameraTriggerDistance: 0, altitude: 50, speed: 5,
    }).waypoints.filter((w) => w.command === "WAYPOINT");
    return bearing(rows[0].lat, rows[0].lon, rows[1].lat, rows[1].lon);
  }

  it("aligning to the wind makes the generated survey fly its legs along the wind", () => {
    for (const wind of [0, 30, 90, 120]) {
      const gridAngle = gridAngleLineBearing(optimalLineBearing(wind));
      expect(axisAngularDifference(flownLegBearing(gridAngle), wind)).toBeLessThan(1);
      expect(windPenalty(gridAngleLineBearing(gridAngle), wind, 8)).toBeCloseTo(0, 6);
    }
  });

  it("reads a grid angle of 0 as east-west legs", () => {
    expect(gridAngleLineBearing(0)).toBe(90);
    expect(axisAngularDifference(flownLegBearing(0), 90)).toBeLessThan(1);
  });
});

describe("windPenalty", () => {
  it("is zero when the legs run parallel to the wind", () => {
    expect(windPenalty(30, 30, 10)).toBeCloseTo(0, 10);
    expect(windPenalty(30, 210, 10)).toBeCloseTo(0, 10);
  });

  it("equals the full wind speed when perpendicular", () => {
    expect(windPenalty(0, 90, 10)).toBeCloseTo(10, 10);
    expect(windPenalty(45, 135, 6)).toBeCloseTo(6, 10);
  });

  it("returns the crosswind component at intermediate angles", () => {
    // 30 degrees off the wind axis at 10 m/s => 10 * sin(30) = 5 m/s.
    expect(windPenalty(0, 30, 10)).toBeCloseTo(5, 10);
    // 60 degrees off => 10 * sin(60) ~= 8.660.
    expect(windPenalty(0, 60, 10)).toBeCloseTo(10 * Math.sin(Math.PI / 3), 10);
  });

  it("scales linearly with wind speed", () => {
    expect(windPenalty(0, 90, 5)).toBeCloseTo(5, 10);
    expect(windPenalty(0, 90, 20)).toBeCloseTo(20, 10);
  });

  it("increases monotonically from parallel to perpendicular", () => {
    const p0 = windPenalty(0, 0, 10);
    const p30 = windPenalty(0, 30, 10);
    const p60 = windPenalty(0, 60, 10);
    const p90 = windPenalty(0, 90, 10);
    expect(p0).toBeLessThan(p30);
    expect(p30).toBeLessThan(p60);
    expect(p60).toBeLessThan(p90);
  });

  it("is zero for no wind or negative wind speed", () => {
    expect(windPenalty(0, 90, 0)).toBe(0);
    expect(windPenalty(0, 90, -5)).toBe(0);
  });

  it("is zero for non-finite wind speed", () => {
    expect(windPenalty(0, 90, NaN)).toBe(0);
    expect(windPenalty(0, 90, Infinity)).toBe(0);
  });

  it("never scores any orientation better than the optimal one", () => {
    const windBearing = 73;
    const best = optimalLineBearing(windBearing);
    const bestPenalty = windPenalty(best, windBearing, 12);
    for (const line of [0, 10, 40, 73, 110, 150, 179]) {
      expect(windPenalty(line, windBearing, 12)).toBeGreaterThanOrEqual(
        bestPenalty - 1e-9,
      );
    }
  });
});
