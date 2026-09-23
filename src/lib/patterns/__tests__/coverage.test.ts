/**
 * @module patterns/__tests__/coverage
 * @description Unit tests for the survey footprint / coverage computation module.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  computeFootprint,
  computeCoverageStats,
  detectCoverageGaps,
  estimateLineSpacingM,
  type SurveyPoint,
} from "../coverage";
import { computeFootprint as gsdFootprint } from "../gsd-calculator";
import type { CameraProfile } from "../gsd-calculator";
import type { CaptureRouteRow } from "../coverage-footprints";

// Test camera chosen so the footprint math is exact and readable:
//   gsd_w = (sensorWidth * alt) / (focal * imageWidth) = (10*alt)/(10*1000) = alt/1000
//   footprintWidth  = gsd_w * imageWidth  = alt
//   gsd_h = (sensorHeight * alt) / (focal * imageHeight) = (8*alt)/(10*800) = alt/1000
//   footprintHeight = gsd_h * imageHeight = 0.8 * alt
const CAM: CameraProfile = {
  name: "Test",
  sensorWidth: 10,
  sensorHeight: 8,
  focalLength: 10,
  imageWidth: 1000,
  imageHeight: 800,
};

const REF_LAT = 12.95;
const REF_LON = 77.6;
const EARTH_R = 6371000;
const DEG_TO_RAD = Math.PI / 180;
const COS_REF = Math.cos(REF_LAT * DEG_TO_RAD);

/** Inverse of the module's equirectangular projection: local meters -> lat/lon. */
function fromLocalXY(x: number, y: number): SurveyPoint {
  return {
    lat: REF_LAT + y / (DEG_TO_RAD * EARTH_R),
    lon: REF_LON + x / (DEG_TO_RAD * EARTH_R * COS_REF),
  };
}

/**
 * Build a boustrophedon (lawnmower) survey route.
 * @param lines        Number of parallel flight lines (north offsets).
 * @param lineSpacing  North spacing between lines, meters.
 * @param lineLength   East length of each line, meters.
 * @param captureStep  Along-track spacing of capture points, meters.
 */
function buildSurvey(
  lines: number,
  lineSpacing: number,
  lineLength: number,
  captureStep: number,
): SurveyPoint[] {
  const pts: SurveyPoint[] = [];
  const steps = Math.round(lineLength / captureStep);
  for (let j = 0; j < lines; j++) {
    const y = j * lineSpacing;
    const leftToRight = j % 2 === 0;
    for (let k = 0; k <= steps; k++) {
      const along = k * captureStep;
      const x = leftToRight ? along : lineLength - along;
      pts.push(fromLocalXY(x, y));
    }
  }
  return pts;
}

describe("computeFootprint (re-export)", () => {
  it("is identical to the gsd-calculator footprint", () => {
    const a = computeFootprint(100, CAM);
    const b = gsdFootprint(100, CAM);
    expect(a).toEqual(b);
  });

  it("scales linearly with altitude for this camera", () => {
    const fp = computeFootprint(100, CAM);
    expect(fp.width).toBeCloseTo(100, 6); // = altitude
    expect(fp.height).toBeCloseTo(80, 6); // = 0.8 * altitude
  });
});

describe("estimateLineSpacingM", () => {
  it("recovers the flight-line spacing from a lawnmower route", () => {
    // Along captures 20 m apart (short legs); lines 30 m apart (longer hops).
    const route = buildSurvey(5, 30, 200, 20);
    expect(estimateLineSpacingM(route)).toBeCloseTo(30, 1);
  });

  it("recovers spacing even when line spacing exceeds capture spacing", () => {
    const route = buildSurvey(4, 60, 200, 15);
    expect(estimateLineSpacingM(route)).toBeCloseTo(60, 0);
  });

  it("returns 0 for a single line (no cross hops)", () => {
    const singleLine: SurveyPoint[] = [];
    for (let k = 0; k <= 10; k++) singleLine.push(fromLocalXY(k * 20, 0));
    expect(estimateLineSpacingM(singleLine)).toBe(0);
  });

  it("returns 0 for empty or single-point input", () => {
    expect(estimateLineSpacingM([])).toBe(0);
    expect(estimateLineSpacingM([fromLocalXY(0, 0)])).toBe(0);
  });
});

/**
 * A generator-shaped survey route: each line is its two transect endpoints,
 * with the camera armed at the start and disarmed at the end when `trigger` > 0.
 */
function buildRoute(
  lines: number,
  lineSpacing: number,
  lineLength: number,
  trigger: number,
  alt = 100,
): CaptureRouteRow[] {
  const rows: CaptureRouteRow[] = [];
  for (let j = 0; j < lines; j++) {
    const y = j * lineSpacing;
    const [x0, x1] = j % 2 === 0 ? [0, lineLength] : [lineLength, 0];
    rows.push({ ...fromLocalXY(x0, y), alt, command: "WAYPOINT" });
    if (trigger > 0) rows.push({ ...fromLocalXY(x0, y), alt, command: "DO_SET_CAM_TRIGG", param1: trigger });
    rows.push({ ...fromLocalXY(x1, y), alt, command: "WAYPOINT" });
    if (trigger > 0) rows.push({ ...fromLocalXY(x1, y), alt, command: "DO_SET_CAM_TRIGG", param1: 0 });
  }
  return rows;
}

describe("computeCoverageStats", () => {
  // 4 lines, 30 m apart, 210 m long, camera every 20 m.
  const route = buildRoute(4, 30, 210, 20);
  const alt = 100; // footprint 100 x 80 m
  const stats = computeCoverageStats(route, CAM, alt);

  it("counts the images the trigger distance takes, not the route rows", () => {
    // One capture at each arming point, then every 20 m (0..200 m): 11 per line.
    expect(stats.imageCount).toBe(44);
    expect(stats.captureSpacingM).toBe(20);
  });

  it("reports the footprint dimensions", () => {
    expect(stats.footprintWidthM).toBeCloseTo(100, 6);
    expect(stats.footprintHeightM).toBeCloseTo(80, 6);
  });

  it("takes line spacing from the navigation points only", () => {
    expect(stats.lineSpacingM).toBeCloseTo(30, 1);
  });

  it("derives side overlap from line spacing vs footprint width", () => {
    // 1 - 30/100 = 70 %
    expect(stats.overlapSidePct).toBeCloseTo(70, 1);
  });

  it("derives front overlap from the trigger distance vs footprint height", () => {
    // 1 - 20/80 = 75 %, though the route has only two points per transect.
    expect(stats.overlapFrontPct).toBeCloseTo(75, 1);
  });

  it("computes swept ground coverage as along-track distance x footprint width", () => {
    // 4 lines x 210 m along-track = 840 m swept; x 100 m width = 84,000 m^2.
    expect(stats.groundCoverageM2).toBeCloseTo(840 * 100, -2);
  });

  it("reports no images and no front overlap when the camera is never armed", () => {
    const noTrigger = computeCoverageStats(buildRoute(4, 30, 200, 0), CAM, alt);
    expect(noTrigger.imageCount).toBe(0);
    expect(noTrigger.captureSpacingM).toBeNull();
    expect(noTrigger.overlapFrontPct).toBeNull();
    expect(noTrigger.overlapSidePct).toBeCloseTo(70, 1);
  });

  it("returns zeroed stats for an empty route", () => {
    const empty = computeCoverageStats([], CAM, alt);
    expect(empty.imageCount).toBe(0);
    expect(empty.groundCoverageM2).toBe(0);
    expect(empty.overlapSidePct).toBe(0);
    expect(empty.overlapFrontPct).toBeNull();
    expect(empty.lineSpacingM).toBe(0);
  });

  it("reports 0 overlaps at zero altitude (no footprint)", () => {
    const s0 = computeCoverageStats(route, CAM, 0);
    expect(s0.footprintWidthM).toBe(0);
    expect(s0.overlapSidePct).toBe(0);
    expect(s0.overlapFrontPct).toBeNull();
  });
});

describe("detectCoverageGaps", () => {
  const alt = 100; // footprint width 100 m

  it("flags no gap when spacing meets the target overlap", () => {
    // spacing 30 m; at 60 % overlap max spacing = 100*(1-0.6) = 40 m.
    const res = detectCoverageGaps(buildRoute(4, 30, 200, 20), CAM, alt, 0.6);
    expect(res.hasGap).toBe(false);
    expect(res.maxSpacingForOverlapM).toBeCloseTo(40, 6);
    expect(res.deficitM).toBe(0);
    expect(res.lineSpacingM).toBeCloseTo(30, 1);
  });

  it("flags a gap when line spacing is too wide for the target overlap", () => {
    // spacing 60 m; at 60 % overlap max spacing = 40 m -> gap of ~20 m.
    const res = detectCoverageGaps(buildRoute(4, 60, 200, 15), CAM, alt, 0.6);
    expect(res.hasGap).toBe(true);
    expect(res.deficitM).toBeCloseTo(20, 0);
  });

  it("flags a gap when the same route demands a higher overlap", () => {
    // spacing 30 m; at 80 % overlap max spacing = 20 m -> gap.
    const res = detectCoverageGaps(buildRoute(4, 30, 200, 20), CAM, alt, 0.8);
    expect(res.hasGap).toBe(true);
    expect(res.maxSpacingForOverlapM).toBeCloseTo(20, 6);
    expect(res.deficitM).toBeCloseTo(10, 0);
  });

  it("defaults to a 60 % target overlap", () => {
    const route = buildRoute(4, 30, 200, 20);
    const withDefault = detectCoverageGaps(route, CAM, alt);
    const explicit = detectCoverageGaps(route, CAM, alt, 0.6);
    expect(withDefault.maxSpacingForOverlapM).toBeCloseTo(
      explicit.maxSpacingForOverlapM,
      6,
    );
  });

  it("never flags a gap for a single-line route", () => {
    const res = detectCoverageGaps(buildRoute(1, 30, 200, 20), CAM, alt, 0.6);
    expect(res.hasGap).toBe(false);
    expect(res.lineSpacingM).toBe(0);
  });
});
