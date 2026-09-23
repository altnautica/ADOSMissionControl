/**
 * @module terrain/sim-default-frame.test
 * @description The 3D simulation places a waypoint that carries no frame of its
 * own in the planner's default frame, the same frame the upload encodes it in.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// Minimal cesium mock. Terrain rises from 100 m at the launch point to 300 m at
// the second waypoint, so each frame puts that waypoint at a different height.
vi.mock("cesium", () => {
  class Cartographic {
    longitude: number;
    latitude: number;
    height: number;
    constructor(lon = 0, lat = 0, height = 0) {
      this.longitude = lon;
      this.latitude = lat;
      this.height = height;
    }
    static fromDegrees(lon: number, lat: number, height = 0) {
      return new Cartographic(lon, lat, height);
    }
  }
  class Cartesian3 {
    height: number;
    constructor(height = 0) {
      this.height = height;
    }
    static fromRadians(_lon: number, _lat: number, height = 0) {
      return new Cartesian3(height);
    }
  }
  const sampleTerrainMostDetailed = vi.fn(async (_p: unknown, cartos: Cartographic[]) =>
    cartos.map((c) => {
      c.height = c.latitude > 12.0005 ? 300 : 100;
      return c;
    }),
  );
  return { Cartographic, Cartesian3, sampleTerrainMostDetailed };
});

import type { TerrainProvider, Cartesian3 } from "cesium";
import type { Waypoint } from "@/lib/types";
import { resolveAGLToAbsolute } from "@/lib/terrain-utils";
import { mslToEllipsoidal, loadGeoidGrid } from "@/lib/terrain/geoid";

const provider = {} as unknown as TerrainProvider;
const heightOf = (c: Cartesian3) => (c as unknown as { height: number }).height;

/** Launch point on 100 m of ground, then a frameless waypoint over 300 m. */
const MISSION: Waypoint[] = [
  { id: "launch", lat: 12.0, lon: 77.0, alt: 0, command: "TAKEOFF" },
  { id: "ridge", lat: 12.0009, lon: 77.0, alt: 50 },
];

beforeAll(async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
  await loadGeoidGrid();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("resolveAGLToAbsolute default frame", () => {
  it("follows the terrain for a frameless waypoint when the planner default is terrain", async () => {
    const result = await resolveAGLToAbsolute(MISSION, provider, "terrain");
    expect(result.waypointIndices).toEqual([0, 1]);
    // 50 m above the 300 m ground below it, not 50 m above the 100 m launch point.
    expect(heightOf(result.positions[1])).toBeCloseTo(350, 6);
  });

  it("places a frameless waypoint at its MSL height when the planner default is absolute", async () => {
    const result = await resolveAGLToAbsolute(MISSION, provider, "absolute");
    expect(heightOf(result.positions[1])).toBeCloseTo(mslToEllipsoidal(50, 12.0009, 77.0), 6);
  });

  it("measures a frameless waypoint from home when the planner default is relative", async () => {
    const result = await resolveAGLToAbsolute(MISSION, provider, "relative");
    expect(heightOf(result.positions[1])).toBeCloseTo(150, 6);
  });

  it("keeps a waypoint's own frame over the planner default", async () => {
    const own: Waypoint[] = [MISSION[0], { ...MISSION[1], frame: "relative" }];
    const result = await resolveAGLToAbsolute(own, provider, "terrain");
    expect(heightOf(result.positions[1])).toBeCloseTo(150, 6);
  });
});
