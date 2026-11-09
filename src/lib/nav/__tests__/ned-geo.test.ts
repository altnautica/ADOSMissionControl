/** NED → lat/lon about the EKF origin, and the global-minimap follow target. */

import { describe, expect, it } from "vitest";

import type { FollowState } from "@/lib/hud/nav-types";
import { haversineDistance } from "@/lib/geo/distance";

import { followTargetGeo, nedToLatLon } from "../ned-geo";

const ORIGIN = { lat: 12.9716, lon: 77.5946 };

function follow(over: Partial<FollowState>): FollowState {
  return {
    active: true,
    phase: "following",
    trackId: 12,
    confidence: 0.9,
    rangeM: 10,
    rangeSigmaM: 0.3,
    rangeCues: [],
    targetSpeedMps: 1,
    aglM: 5,
    aglSource: "rng",
    reacquireMode: "strict",
    coastRemainingS: null,
    pipelineLatencyMs: 80,
    holdReason: null,
    bearingDeg: 0,
    depressionDeg: 20,
    targetNed: null,
    targetVelNed: null,
    predictedBbox: null,
    ...over,
  };
}

describe("nedToLatLon", () => {
  it("returns the origin for a zero offset", () => {
    expect(nedToLatLon(ORIGIN, 0, 0)).toEqual([ORIGIN.lat, ORIGIN.lon]);
  });

  it("moves north along the meridian and east along the parallel", () => {
    const [nLat, nLon] = nedToLatLon(ORIGIN, 100, 0);
    expect(nLat).toBeGreaterThan(ORIGIN.lat);
    expect(nLon).toBeCloseTo(ORIGIN.lon, 9);
    expect(haversineDistance(ORIGIN.lat, ORIGIN.lon, nLat, nLon)).toBeCloseTo(100, 2);

    const [eLat, eLon] = nedToLatLon(ORIGIN, 0, 100);
    expect(eLon).toBeGreaterThan(ORIGIN.lon);
    expect(eLat).toBeCloseTo(ORIGIN.lat, 6);
    expect(haversineDistance(ORIGIN.lat, ORIGIN.lon, eLat, eLon)).toBeCloseTo(100, 2);
  });

  it("keeps a diagonal offset at its length", () => {
    const [lat, lon] = nedToLatLon(ORIGIN, -30, -40);
    expect(lat).toBeLessThan(ORIGIN.lat);
    expect(lon).toBeLessThan(ORIGIN.lon);
    expect(haversineDistance(ORIGIN.lat, ORIGIN.lon, lat, lon)).toBeCloseTo(50, 2);
  });
});

describe("followTargetGeo (global minimap target)", () => {
  it("is hidden without an origin, a target position or a follow state", () => {
    expect(followTargetGeo(follow({ targetNed: [5, 5] }), null)).toBeNull();
    expect(followTargetGeo(follow({ targetNed: null }), ORIGIN)).toBeNull();
    expect(followTargetGeo(null, ORIGIN)).toBeNull();
  });

  it("places the target and its 1 s tick about the origin, solid while following", () => {
    const geo = followTargetGeo(follow({ targetNed: [10, 0], targetVelNed: [2, 0] }), ORIGIN);
    expect(geo).not.toBeNull();
    expect(geo?.dashed).toBe(false);
    expect(geo?.position).toEqual(nedToLatLon(ORIGIN, 10, 0));
    expect(geo?.tick).toEqual(nedToLatLon(ORIGIN, 12, 0));
  });

  it("is dashed while coasting or searching and has no tick without a velocity", () => {
    for (const phase of ["coasting", "searching"] as const) {
      const geo = followTargetGeo(follow({ phase, targetNed: [1, 1] }), ORIGIN);
      expect(geo?.dashed).toBe(true);
      expect(geo?.tick).toBeNull();
    }
  });
});
