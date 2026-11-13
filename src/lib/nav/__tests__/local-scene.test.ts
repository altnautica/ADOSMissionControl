/** Local-frame draw list: tile placement (M1), grid, layers and the view. */

import { describe, expect, it } from "vitest";

import { EMPTY_OCCUPANCY, type OccupancyGrid } from "@/lib/hud/local-frame";
import {
  RECENTRE_AFTER_MS,
  buildLocalScene,
  localPlan,
  stepZoom,
  viewCentre,
  wheelZoom,
  type LocalSceneInput,
} from "@/lib/hud/local-scene";

const view = { centreX: 0, centreY: 0, pxPerM: 10, cx: 100, cy: 100 };

function input(over: Partial<LocalSceneInput> = {}): LocalSceneInput {
  return {
    width: 200,
    height: 200,
    view,
    occupancy: EMPTY_OCCUPANCY,
    occupancyStale: false,
    trail: [],
    scanPoints: null,
    target: null,
    drone: null,
    plan: null,
    ...over,
  };
}

describe("buildLocalScene", () => {
  it("M1: tile (0, -1) at 0.05 m is anchored at its north-west corner (x 3.2, y -3.2)", () => {
    const occupancy: OccupancyGrid = {
      seq: 1,
      resM: 0.05,
      tileCells: 64,
      tiles: { "0,-1": { ix: 0, iy: -1, pngB64: "", seq: 1 } },
    };
    const scene = buildLocalScene(input({ occupancy }));
    expect(scene.tiles).toHaveLength(1);
    const t = scene.tiles[0];
    // screen = centre + (y, −x)·pxPerM = (100 − 32, 100 − 32), 32 px square.
    expect(t.sx).toBeCloseTo(68);
    expect(t.sy).toBeCloseTo(68);
    expect(t.sizePx).toBeCloseTo(32);
  });

  it("culls tiles outside the view", () => {
    const occupancy: OccupancyGrid = {
      seq: 1,
      resM: 0.05,
      tileCells: 64,
      tiles: { "20,0": { ix: 20, iy: 0, pngB64: "", seq: 1 } },
    };
    expect(buildLocalScene(input({ occupancy })).tiles).toHaveLength(0);
  });

  it("draws the grid at the scale-bar step and reports the bar length", () => {
    const scene = buildLocalScene(input());
    expect(scene.gridStepM).toBe(5);
    expect(scene.scaleBar).toEqual({ m: 5, px: 50 });
    // ±10 m visible each way: lines at −10, −5, 0, 5, 10 in both axes.
    expect(scene.grid).toHaveLength(10);
  });

  it("projects the origin, the drone, the scan and the target with its 1 s tick", () => {
    const scene = buildLocalScene(
      input({
        drone: { north: 1, east: 2, yawDeg: 45 },
        scanPoints: [
          [0, 5],
          [50, 0],
        ],
        target: { north: 2, east: 0, velNorth: 1, velEast: 0, dashed: true },
      }),
    );
    expect(scene.origin).toEqual({ sx: 100, sy: 100 });
    expect(scene.drone).toEqual({ sx: 120, sy: 90, yawDeg: 45 });
    expect(scene.scan).toEqual([[150, 100]]);
    expect(scene.target).toEqual({ sx: 100, sy: 80, tickX: 100, tickY: 70, dashed: true });
  });

  it("splits the trail into runs and keeps the dim flag", () => {
    const scene = buildLocalScene(
      input({
        occupancyStale: true,
        trail: [
          { x: 0, y: 0, at: 0, health: "good" },
          { x: 1, y: 0, at: 1, health: "good" },
        ],
      }),
    );
    expect(scene.dim).toBe(true);
    expect(scene.trail).toEqual([{ points: [[100, 100], [100, 90]], dashed: false }]);
  });

  it("projects the pilot's planned path and goal, north up the screen", () => {
    const scene = buildLocalScene(
      input({
        plan: localPlan({ planNed: [[0, 0], [5, 0], [5, 2]], goalNed: [5, 2, -5], avoidState: "clear" }),
      }),
    );
    expect(scene.plan).toEqual({ points: [[100, 100], [100, 50], [120, 50]], goal: [120, 50], blocked: false });
    const blocked = localPlan({ planNed: [], goalNed: [1, 0, -5], avoidState: "blocked" });
    expect(buildLocalScene(input({ plan: blocked })).plan).toEqual({ points: [], goal: [100, 90], blocked: true });
    expect(buildLocalScene(input()).plan).toBeNull();
  });
});

describe("view controls", () => {
  it("follows a pan for 10 s, then recentres on the drone", () => {
    const pan = { north: 5, east: 5, at: 1000 };
    const drone = { north: 1, east: 2 };
    expect(viewCentre(pan, drone, 1000 + RECENTRE_AFTER_MS - 1)).toEqual({ north: 5, east: 5 });
    expect(viewCentre(pan, drone, 1000 + RECENTRE_AFTER_MS)).toEqual(drone);
    expect(viewCentre(null, null, 0)).toEqual({ north: 0, east: 0 });
  });

  it("clamps zoom to 2–80 px/m", () => {
    expect(stepZoom(80, 1)).toBe(80);
    expect(stepZoom(2, -1)).toBe(2);
    expect(stepZoom(10, 1)).toBeCloseTo(12.5);
    expect(wheelZoom(10, -100)).toBeGreaterThan(10);
    expect(wheelZoom(10, 1e6)).toBe(2);
  });
});
