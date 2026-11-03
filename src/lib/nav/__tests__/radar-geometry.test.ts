/** Radar companion view: scan dots (R1), readout bands (R2) and scale. */

import { describe, expect, it } from "vitest";

import type { NavScan } from "@/lib/agent/nav-types";

import {
  autoRadarScale,
  cycleRadarScale,
  nearestScanM,
  radarBand,
  radarScanDots,
} from "../radar-geometry";

function scanWith(entries: Record<number, number>): NavScan {
  const ranges = new Array(360).fill(0);
  for (const [i, r] of Object.entries(entries)) ranges[Number(i)] = r;
  return { frame: "body_frd", angleStartRad: 0, angleIncrementRad: Math.PI / 180, ranges };
}

describe("radar geometry", () => {
  it("R1 a return at 90° (right) sits right of centre", () => {
    const dots = radarScanDots(scanWith({ 90: 2 }), 6, 60, 100, 100);
    expect(dots).toHaveLength(1);
    expect(dots[0].x).toBeCloseTo(120);
    expect(dots[0].y).toBeCloseTo(100);
  });

  it("drops returns beyond the display range and decimates", () => {
    expect(radarScanDots(scanWith({ 0: 7 }), 6, 60, 0, 0)).toHaveLength(0);
    const full = scanWith(Object.fromEntries(Array.from({ length: 360 }, (_, i) => [i, 1])));
    expect(radarScanDots(full, 6, 60, 0, 0, 120)).toHaveLength(120);
  });

  it("R2 nearest 1.8 m reads DANGER", () => {
    expect(radarBand(1.8)).toBe("danger");
    expect(radarBand(3)).toBe("caution");
    expect(radarBand(6)).toBe("clear");
    expect(radarBand(null)).toBe("clear");
  });

  it("auto scale and cycling", () => {
    expect(autoRadarScale(1)).toBe(3);
    expect(autoRadarScale(4)).toBe(6);
    expect(autoRadarScale(9)).toBe(12);
    expect(autoRadarScale(null)).toBe(12);
    expect(cycleRadarScale(3)).toBe(6);
    expect(cycleRadarScale(6)).toBe(12);
    expect(cycleRadarScale(12)).toBe("auto");
    expect(cycleRadarScale("auto")).toBe(3);
  });

  it("nearest return", () => {
    expect(nearestScanM(scanWith({ 10: 4, 20: 2.5 }))).toBe(2.5);
    expect(nearestScanM(scanWith({}))).toBeNull();
    expect(nearestScanM(null)).toBeNull();
  });
});
