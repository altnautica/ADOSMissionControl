/** Local-frame geometry: occupancy tile placement (M1), merging, projection,
 * scan transform, trail and scale bar. */

import { describe, expect, it } from "vitest";

import type { NavPose, NavScan, OccupancyLive } from "@/lib/hud/nav-types";

import {
  EMPTY_OCCUPANCY,
  OCCUPANCY_TILE_LIMIT,
  appendTrail,
  mapToScreen,
  mergeOccupancy,
  occupancyClass,
  poseYawDeg,
  scaleBarStep,
  scanBodyPoints,
  scanToMap,
  tileFootprint,
  trailRuns,
  type TrailPoint,
} from "@/lib/hud/local-frame";

function live(seq: number, tiles: Array<[number, number, string]>, resM = 0.05): OccupancyLive {
  return {
    seq,
    frame: "map_ned",
    resM,
    tileCells: 64,
    tiles: tiles.map(([ix, iy, pngB64]) => ({ ix, iy, pngB64 })),
  };
}

describe("occupancy tiles", () => {
  it("M1 tile (0,-1) at 0.05 m", () => {
    const f = tileFootprint(0, -1, 0.05, 64);
    expect(f.northMin).toBeCloseTo(0);
    expect(f.northMax).toBeCloseTo(3.2);
    expect(f.eastMin).toBeCloseTo(-3.2);
    expect(f.eastMax).toBeCloseTo(0);
    expect(f.anchorX).toBeCloseTo(3.2);
    expect(f.anchorY).toBeCloseTo(-3.2);
  });

  it("merges by (ix, iy), newest PNG wins, seq carried", () => {
    let g = mergeOccupancy(EMPTY_OCCUPANCY, live(1, [[0, 0, "a"], [0, 1, "b"]]));
    g = mergeOccupancy(g, live(2, [[0, 0, "c"]]));
    expect(g.seq).toBe(2);
    expect(Object.keys(g.tiles)).toEqual(["0,1", "0,0"]);
    expect(g.tiles["0,0"]).toEqual({ ix: 0, iy: 0, pngB64: "c", seq: 2 });
  });

  it("keeps identity on an empty poll", () => {
    const g = mergeOccupancy(EMPTY_OCCUPANCY, live(3, [[1, 1, "a"]]));
    expect(mergeOccupancy(g, live(3, []))).toBe(g);
  });

  it("starts a new session on a backwards seq or a grid change", () => {
    const g = mergeOccupancy(EMPTY_OCCUPANCY, live(5, [[0, 0, "a"]]));
    expect(Object.keys(mergeOccupancy(g, live(1, [[2, 2, "x"]])).tiles)).toEqual(["2,2"]);
    expect(Object.keys(mergeOccupancy(g, live(6, [[3, 3, "y"]], 0.1)).tiles)).toEqual(["3,3"]);
  });

  it("drops the least recently changed tiles past the limit", () => {
    const tiles: Array<[number, number, string]> = [];
    for (let i = 0; i < OCCUPANCY_TILE_LIMIT + 3; i++) tiles.push([i, 0, "p"]);
    const g = mergeOccupancy(EMPTY_OCCUPANCY, live(1, tiles));
    expect(Object.keys(g.tiles)).toHaveLength(OCCUPANCY_TILE_LIMIT);
    expect(g.tiles["0,0"]).toBeUndefined();
    expect(g.tiles[`${OCCUPANCY_TILE_LIMIT + 2},0`]).toBeDefined();
  });

  it("classifies grey values", () => {
    expect(occupancyClass(0)).toBe("occupied");
    expect(occupancyClass(100)).toBe("occupied");
    expect(occupancyClass(205)).toBe("unknown");
    expect(occupancyClass(254)).toBe("free");
  });
});

describe("projection and transforms", () => {
  it("north up, east right", () => {
    const view = { centreX: 0, centreY: 0, pxPerM: 10, cx: 100, cy: 100 };
    expect(mapToScreen(view, 2, 0)).toEqual({ sx: 100, sy: 80 });
    expect(mapToScreen(view, 0, 3)).toEqual({ sx: 130, sy: 100 });
  });

  const scan: NavScan = {
    frame: "body_frd",
    angleStartRad: 0,
    angleIncrementRad: Math.PI / 2,
    ranges: [2, 1, 0, 30],
  };

  it("body points are forward/right, no-return skipped", () => {
    const pts = scanBodyPoints(scan, 12);
    expect(pts).toHaveLength(2);
    expect(pts[0][0]).toBeCloseTo(2);
    expect(pts[0][1]).toBeCloseTo(0);
    expect(pts[1][0]).toBeCloseTo(0);
    expect(pts[1][1]).toBeCloseTo(1);
  });

  it("scan to map applies p = t + R·p", () => {
    // Yaw 90°: body forward points east.
    const pose: NavPose = { R: [0, -1, 0, 1, 0, 0, 0, 0, 1], t: [5, 5, -2], health: "good", frame: "map_ned", source: null };
    expect(poseYawDeg(pose)).toBeCloseTo(90);
    const pts = scanToMap({ ...scan, ranges: [2, 0, 0, 0] }, pose);
    expect(pts[0][0]).toBeCloseTo(5);
    expect(pts[0][1]).toBeCloseTo(7);
  });
});

describe("trail", () => {
  it("decimates by spacing and windows by time", () => {
    let t: TrailPoint[] = [];
    t = appendTrail(t, { x: 0, y: 0, at: 0, health: "good" });
    t = appendTrail(t, { x: 0.1, y: 0, at: 100, health: "good" });
    expect(t).toHaveLength(1);
    t = appendTrail(t, { x: 0.3, y: 0, at: 200, health: "good" });
    expect(t).toHaveLength(2);
    t = appendTrail(t, { x: 5, y: 0, at: 121_000, health: "good" });
    expect(t.map((p) => p.at)).toEqual([121_000]);
  });

  it("splits runs at lost points and dashes degraded runs", () => {
    const pts: TrailPoint[] = [
      { x: 0, y: 0, at: 0, health: "good" },
      { x: 1, y: 0, at: 1, health: "good" },
      { x: 2, y: 0, at: 2, health: "degraded" },
      { x: 3, y: 0, at: 3, health: "lost" },
      { x: 4, y: 0, at: 4, health: "good" },
      { x: 5, y: 0, at: 5, health: "good" },
    ];
    const runs = trailRuns(pts);
    expect(runs.map((r) => [r.dashed, r.points.map((p) => p.x)])).toEqual([
      [false, [0, 1]],
      [true, [1, 2]],
      [false, [4, 5]],
    ]);
  });
});

describe("scale bar", () => {
  it("picks a 40-80 px step", () => {
    expect(scaleBarStep(40)).toBe(1);
    expect(scaleBarStep(10)).toBe(5);
    expect(scaleBarStep(2)).toBe(20);
    expect(scaleBarStep(0.5)).toBe(50);
  });
});
