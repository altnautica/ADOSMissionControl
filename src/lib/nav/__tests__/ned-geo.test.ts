/** NED → lat/lon about the EKF origin, and the global-minimap follow target. */

import { describe, expect, it } from "vitest";

import { followState } from "@/components/cockpit/__tests__/follow-fixtures";
import type { FollowState } from "@/lib/hud/nav-types";
import { haversineDistance } from "@/lib/geo/distance";

import { followTargetGeo, nedToLatLon, searchAreaRingNe } from "../ned-geo";

const ORIGIN = { lat: 12.9716, lon: 77.5946 };

function follow(over: Partial<FollowState>): FollowState {
  return followState({ reacquireMode: "strict", bearingDeg: 0, depressionDeg: 20, ...over });
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

  it("is dashed while the subject is sought and has no tick without a velocity", () => {
    for (const phase of ["predicting", "repositioning", "searching"] as const) {
      const geo = followTargetGeo(follow({ phase, targetNed: [1, 1] }), ORIGIN);
      expect(geo?.dashed).toBe(true);
      expect(geo?.tick).toBeNull();
    }
  });

  it("carries the search ring, the predicted path and the vantage point only while sought", () => {
    const recovery: Partial<FollowState> = {
      targetNed: [10, 0],
      searchArea: { centerNe: [10, 0], semiMajorM: 4, semiMinorM: 2, headingDeg: 90 },
      predictedPathNe: [
        [10, 0],
        [10, 1],
      ],
      vantageNe: [3, -2],
    };
    const geo = followTargetGeo(follow({ ...recovery, phase: "searching" }), ORIGIN)!;
    expect(geo.searchRing).toHaveLength(36);
    expect(geo.searchRing![0]).toEqual(nedToLatLon(ORIGIN, 10, 4));
    expect(geo.predictedPath).toEqual([nedToLatLon(ORIGIN, 10, 0), nedToLatLon(ORIGIN, 10, 1)]);
    expect(geo.vantage).toEqual(nedToLatLon(ORIGIN, 3, -2));

    const following = followTargetGeo(follow({ ...recovery, phase: "following" }), ORIGIN)!;
    expect(following).toMatchObject({ searchRing: null, predictedPath: [], vantage: null });
    expect(followTargetGeo(follow({ ...recovery, phase: "holding-await-operator" }), ORIGIN)).toBeNull();
  });
});

describe("searchAreaRingNe", () => {
  it("lays the major axis along the heading, clockwise from north", () => {
    const close = (ring: Array<[number, number]>, want: Array<[number, number]>) =>
      ring.forEach(([n, e], i) => {
        expect(n).toBeCloseTo(want[i][0], 9);
        expect(e).toBeCloseTo(want[i][1], 9);
      });
    const area = { centerNe: [1, 1] as [number, number], semiMajorM: 4, semiMinorM: 2 };
    close(searchAreaRingNe({ ...area, headingDeg: 0 }, 4), [
      [5, 1],
      [1, 3],
      [-3, 1],
      [1, -1],
    ]);
    // Heading east: the major axis lies along east.
    close(searchAreaRingNe({ ...area, headingDeg: 90 }, 4), [
      [1, 5],
      [-1, 1],
      [1, -3],
      [3, 1],
    ]);
  });
});
