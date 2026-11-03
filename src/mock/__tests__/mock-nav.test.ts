/**
 * @module mock-nav.test
 * @description The demo navigation feed: the synthetic room's ray caster,
 * the occupancy tile synthesis and progressive reveal (PNG encoding stubbed),
 * the EKF flags implied by the commanded source set, and the stream filling
 * the nav-stream store at its rates.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_OCCUPANCY, mergeOccupancy, tileFootprint } from "@/lib/nav/local-frame";
import { getMockEkfSourceSet, mockEkfFlags, setMockEkfSourceSet } from "@/mock/mock-ekf-source";
import { MockNavStream, demoMapStatus } from "@/mock/mock-nav";
import { demoLoopAt, obstacleSectorsCm, rayCast, scanRanges, yawMatrix } from "@/mock/mock-nav-world";
import {
  GREY_FREE,
  GREY_OCCUPIED,
  GREY_UNKNOWN,
  OCC_RES_M,
  OCC_TILE_CELLS,
  OccupancyReveal,
  tileGrey,
  type GreyPngEncoder,
} from "@/mock/mock-occupancy";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const stubEncoder: GreyPngEncoder = (grey, w, h) => `png:${w}x${h}:${grey.length}`;

describe("synthetic room", () => {
  it("ray-casts to the walls and pillars", () => {
    expect(rayCast(0, 0, 0)).toBeCloseTo(6);
    // The pillar at (0.2, 4.6) r 0.3 sits across the east ray.
    expect(rayCast(0, 0, Math.PI / 2)).toBeCloseTo(4.6 - Math.sqrt(0.09 - 0.04), 5);
    expect(rayCast(0, 0, 0, 3)).toBe(0);
  });

  it("scans 360 body-frame rays that all hit inside the closed room", () => {
    const loop = demoLoopAt(7);
    const ranges = scanRanges(loop.x, loop.y, loop.yawRad);
    expect(ranges).toHaveLength(360);
    expect(ranges.every((r) => r > 0 && r < 12)).toBe(true);
    expect(ranges[0]).toBeCloseTo(rayCast(loop.x, loop.y, loop.yawRad));
  });

  it("emits obstacle sectors in cm with the nearest return", () => {
    const sectors = obstacleSectorsCm(0, 0, 0, 12, 1200);
    expect(sectors).toHaveLength(12);
    expect(sectors[0]).toBe(600);
  });

  it("flies a loop whose heading follows its velocity", () => {
    const s = demoLoopAt(0);
    expect(s.x).toBeCloseTo(3);
    expect(s.y).toBeCloseTo(0);
    expect(s.yawRad).toBeCloseTo(Math.PI / 2);
    expect(yawMatrix(Math.PI / 2).map((v) => Math.round(v))).toEqual([0, -1, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe("occupancy synthesis", () => {
  it("places rows north-down and columns west-east", () => {
    const n = OCC_TILE_CELLS;
    const ne = tileGrey(1, 1); // x, y ∈ [3.2, 6.4)
    expect(ne[0 * n + (n - 1)]).toBe(GREY_UNKNOWN); // (6.375, 6.375): outside
    expect(ne[(n - 1) * n + 0]).toBe(GREY_FREE); // (3.225, 3.225): floor
    expect(ne[7 * n + 0]).toBe(GREY_OCCUPIED); // x = 6.025: north wall
    const fp = tileFootprint(1, 1, OCC_RES_M, n);
    expect(fp.northMax).toBeCloseTo(6.4);
    expect(fp.eastMin).toBeCloseTo(3.2);
  });

  it("draws the pillars as occupied cells", () => {
    const n = OCC_TILE_CELLS;
    const tile = tileGrey(1, -2); // holds the pillar at (3.5, -3.5)
    expect(tile[57 * n + 57]).toBe(GREY_OCCUPIED);
  });

  it("reveals one tile per poll, nearest first, with an increasing seq", () => {
    const encode = vi.fn(stubEncoder);
    const reveal = new OccupancyReveal(encode);
    const first = reveal.next();
    expect(first).toMatchObject({ seq: 1, frame: "map_ned", resM: OCC_RES_M, tileCells: OCC_TILE_CELLS });
    expect(first.tiles).toEqual([{ ix: -1, iy: -1, pngB64: "png:64x64:4096" }]);
    let grid = mergeOccupancy(EMPTY_OCCUPANCY, first);
    for (let i = 1; i < 16; i++) grid = mergeOccupancy(grid, reveal.next());
    expect(Object.keys(grid.tiles)).toHaveLength(16);
    expect(grid.seq).toBe(16);
    const idle = reveal.next();
    expect(idle).toMatchObject({ seq: 16, tiles: [] });
    expect(encode).toHaveBeenCalledTimes(16);
  });

  it("reveals nothing when the encoder cannot encode", () => {
    const reveal = new OccupancyReveal(() => null);
    expect(reveal.next()).toMatchObject({ seq: 0, tiles: [] });
    expect(reveal.revealedCount).toBe(0);
  });
});

describe("EKF source flags", () => {
  afterEach(() => setMockEkfSourceSet(1));

  it("reports an absolute position except on the flow set", () => {
    expect(mockEkfFlags(1) & 16).toBe(16);
    expect(mockEkfFlags(1) & 128).toBe(0);
    expect(mockEkfFlags(2) & 16).toBe(0);
    expect(mockEkfFlags(2) & 2).toBe(2);
    setMockEkfSourceSet(2);
    expect(getMockEkfSourceSet()).toBe(2);
    expect(mockEkfFlags()).toBe(mockEkfFlags(2));
  });
});

describe("map status", () => {
  it("grows the sweep and reports an uploading hybrid session", () => {
    const a = demoMapStatus(10, 2);
    const b = demoMapStatus(20, 4);
    expect(a).toMatchObject({ sessionId: "demo-session", placement: "hybrid", voxelM: 0.1, navPose: "always" });
    expect(a.upload?.state).toBe("uploading");
    expect(a.stream).toEqual({ state: "off", bytesPerS: 0 });
    expect(b.sweepPoints!).toBeGreaterThan(a.sweepPoints!);
    expect(b.areaM2!).toBeGreaterThan(a.areaM2!);
  });
});

describe("MockNavStream", () => {
  let stream: MockNavStream;

  beforeEach(() => {
    vi.useFakeTimers();
    stream = new MockNavStream(stubEncoder);
  });

  afterEach(() => {
    stream.stop();
    setMockEkfSourceSet(1);
    vi.useRealTimers();
  });

  it("fills follow, nav, pose, scan, map and occupancy for the drone", () => {
    stream.start("node:demo", Date.now());
    vi.advanceTimersByTime(1000);
    const feed = useNavStreamStore.getState().byDrone["node:demo"];
    expect(feed?.follow?.data.phase).toBe("idle");
    expect(feed?.nav?.data).toMatchObject({ mode: "external_nav", activeSet: 1, extnavHealth: "good", odomRateHz: 30, obstacleRateHz: 10 });
    expect(feed?.nav?.data.minObstacleM).toBeGreaterThan(0);
    expect(feed?.pose?.data.frame).toBe("map_ned");
    expect(feed?.pose?.data.R).toHaveLength(9);
    expect(feed?.scan?.data.ranges).toHaveLength(360);
    expect(feed?.map?.data.sessionId).toBe("demo-session");
    expect(Object.keys(feed?.occupancy.tiles ?? {})).toHaveLength(2);
    expect(feed?.trail.length).toBeGreaterThan(0);
  });

  it("reports the commanded source set in nav.state", () => {
    stream.start("node:demo", Date.now());
    setMockEkfSourceSet(2);
    vi.advanceTimersByTime(500);
    expect(useNavStreamStore.getState().byDrone["node:demo"]?.nav?.data).toMatchObject({
      activeSet: 2,
      mode: "optical_flow",
    });
  });

  it("clears the drone's feed on stop", () => {
    stream.start("node:demo", Date.now());
    vi.advanceTimersByTime(500);
    stream.stop();
    expect(useNavStreamStore.getState().byDrone["node:demo"]).toBeUndefined();
    expect(stream.isRunning()).toBe(false);
  });
});
