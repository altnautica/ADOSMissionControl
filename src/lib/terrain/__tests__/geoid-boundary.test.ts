/**
 * @module terrain/geoid-boundary.test
 * @description Tests the two Cesium-visualization boundaries that consume the
 * geoid: (1) resolveAGLToAbsolute places an `absolute`-frame waypoint at the
 * geoid-corrected ellipsoidal height (+N, terrain NOT added) while AGL frames
 * stay terrain+AGL; (2) extractPositions tags each flown-track point `amsl` only
 * when the absolute `alt` channel was used (false on the relativeAlt fallback),
 * which drives the flown-track geoid correction downstream.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Minimal cesium mock: enough surface for terrain-utils. Cartesian3.fromRadians
// stores the absolute height so the resolved placement can be read back.
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
    static fromCartesian(c: { longitude: number; latitude: number; height: number }) {
      return new Cartographic(c.longitude, c.latitude, c.height);
    }
  }
  class Cartesian3 {
    longitude: number;
    latitude: number;
    height: number;
    constructor(lon = 0, lat = 0, height = 0) {
      this.longitude = lon;
      this.latitude = lat;
      this.height = height;
    }
    static fromRadians(lon: number, lat: number, height = 0) {
      return new Cartesian3(lon, lat, height);
    }
    static fromDegrees(lon: number, lat: number, height = 0) {
      return new Cartesian3(lon, lat, height);
    }
  }
  // Fake terrain: every sampled point sits on 200 m of ground.
  const sampleTerrainMostDetailed = vi.fn(async (_p: unknown, cartos: Cartographic[]) =>
    cartos.map((c) => {
      c.height = 200;
      return c;
    }),
  );
  return { Cartographic, Cartesian3, sampleTerrainMostDetailed };
});

import type { TerrainProvider, Cartesian3 } from "cesium";
import type { Waypoint } from "@/lib/types";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { resolveAGLToAbsolute } from "@/lib/terrain-utils";
import { mslToEllipsoidal, loadGeoidGrid } from "@/lib/terrain/geoid";
import { extractPositions } from "@/stores/sim-replay-store";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSET = join(HERE, "..", "..", "..", "..", "public", "geoid", "egm96-1deg.i16.gz");
const assetExists = existsSync(ASSET);
const assetBytes = assetExists ? readFileSync(ASSET) : null;

const TERRAIN_H = 200;
/** Read the placement height off a mocked Cartesian3. */
function heightOf(c: Cartesian3): number {
  return (c as unknown as { height: number }).height;
}

beforeAll(async () => {
  if (assetBytes) {
    const ab = assetBytes.buffer.slice(
      assetBytes.byteOffset,
      assetBytes.byteOffset + assetBytes.byteLength,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => ab }) as unknown as Response),
    );
  } else {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
  }
  // Warm the shared geoid singleton so both the code-under-test and the test's
  // own mslToEllipsoidal reference read the same grid state.
  await loadGeoidGrid();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("resolveAGLToAbsolute — frame-aware placement", () => {
  it("places an absolute-frame waypoint at MSL+N (terrain not added) and AGL at terrain+AGL", async () => {
    const lat = 12.0;
    const lon = 77.0;
    const waypoints: Waypoint[] = [
      { id: "a", lat, lon, alt: 500, frame: "absolute" },
      // Frameless in a relative-default mission. Kept close so no intermediate
      // sub-samples are inserted (waypointIndices stays [0, 1]).
      { id: "b", lat: lat + 0.0001, lon: lon + 0.0001, alt: 100 },
    ];
    const provider = {} as unknown as TerrainProvider;

    const result = await resolveAGLToAbsolute(waypoints, provider, "relative", waypoints[0]);
    expect(result.waypointIndices).toEqual([0, 1]);

    const absHeight = heightOf(result.positions[result.waypointIndices[0]]);
    const relHeight = heightOf(result.positions[result.waypointIndices[1]]);

    // Absolute frame: geoid-corrected MSL, terrain NOT added.
    expect(absHeight).toBeCloseTo(mslToEllipsoidal(500, lat, lon), 6);
    expect(absHeight).not.toBeCloseTo(TERRAIN_H + 500, 0);

    // Relative frame: terrain + AGL, unchanged behaviour.
    expect(relHeight).toBeCloseTo(TERRAIN_H + 100, 6);
  });

  it("applies a real +N shift when the bundled grid is present", async () => {
    if (!assetExists) return; // honest: no asset -> no shift to assert
    const lat = 38.625473;
    const lon = 359.9995; // control point 5, N ~ +50 m
    const waypoints: Waypoint[] = [{ id: "a", lat, lon, alt: 100, frame: "absolute" }];
    const provider = {} as unknown as TerrainProvider;

    const result = await resolveAGLToAbsolute(waypoints, provider, "relative", waypoints[0]);
    const h = heightOf(result.positions[0]);
    // Shifted up by the (positive) undulation, not left at raw 100 and not at
    // terrain+100.
    expect(h).toBeGreaterThan(130);
    expect(h).toBeCloseTo(mslToEllipsoidal(100, lat, lon), 6);
    expect(h).not.toBe(100);
  });
});

describe("extractPositions — amsl tagging", () => {
  it("tags amsl=true when the absolute alt channel is used, false on the relativeAlt fallback", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "position", data: { lat: 12, lon: 77, alt: 512.5 } },
      { offsetMs: 100, channel: "globalPosition", data: { lat: 12.1, lon: 77.1, relativeAlt: 80 } },
      // Neither channel present -> alt 0, amsl false (never faked as MSL).
      { offsetMs: 200, channel: "position", data: { lat: 12.2, lon: 77.2 } },
      // Non-position channel is ignored entirely.
      { offsetMs: 300, channel: "battery", data: { voltage: 15.8 } },
    ];

    const pts = extractPositions(frames);
    expect(pts).toHaveLength(3);

    expect(pts[0]).toEqual({ lat: 12, lon: 77, alt: 512.5, amsl: true });
    expect(pts[1]).toEqual({ lat: 12.1, lon: 77.1, alt: 80, amsl: false });
    expect(pts[2]).toEqual({ lat: 12.2, lon: 77.2, alt: 0, amsl: false });
  });
});
