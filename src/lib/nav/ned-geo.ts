/**
 * @module nav/ned-geo
 * @description Local north/east metres → latitude/longitude about the EKF
 * origin, and the follow target placed on the global (tile) minimap: the
 * target, and while it is sought its search ellipse, predicted path and the
 * vantage point (`followSceneTarget` decides what shows). At the ranges a
 * follow target sits from its origin the spherical offset is exact to well
 * under a centimetre.
 *
 * @license GPL-3.0-only
 */

import { followSceneTarget } from "@/lib/hud/local-scene";
import type { FollowState, SearchArea } from "@/lib/hud/nav-types";
import { offsetPoint } from "@/lib/drawing/geo-utils";

/** `(north, east)` metres from `origin` as `[lat, lon]` degrees. */
export function nedToLatLon(origin: { lat: number; lon: number }, north: number, east: number): [number, number] {
  const distance = Math.hypot(north, east);
  if (distance === 0) return [origin.lat, origin.lon];
  const bearingDeg = (Math.atan2(east, north) * 180) / Math.PI;
  return offsetPoint(origin.lat, origin.lon, bearingDeg, distance);
}

/** Points sampled around the search ellipse's outline. */
export const SEARCH_RING_POINTS = 36;

/** The search ellipse as a closed ring of `(north, east)` points: the major
 * axis lies along `headingDeg` (clockwise from north). */
export function searchAreaRingNe(a: SearchArea, points = SEARCH_RING_POINTS): Array<[number, number]> {
  const h = (a.headingDeg * Math.PI) / 180;
  const [un, ue] = [Math.cos(h), Math.sin(h)];
  const [vn, ve] = [-Math.sin(h), Math.cos(h)];
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points; i++) {
    const t = (2 * Math.PI * i) / points;
    const ca = a.semiMajorM * Math.cos(t);
    const sb = a.semiMinorM * Math.sin(t);
    out.push([a.centerNe[0] + ca * un + sb * vn, a.centerNe[1] + ca * ue + sb * ve]);
  }
  return out;
}

export interface FollowTargetGeo {
  position: [number, number];
  /** Where the target will be in 1 s, or null without a velocity. */
  tick: [number, number] | null;
  /** Sought (predicting, moving to look, searching): drawn dashed in the
   * coast colour. */
  dashed: boolean;
  /** The search ellipse outline while the subject is sought, else null. */
  searchRing: Array<[number, number]> | null;
  /** The predicted subject path while the subject is sought, else empty. */
  predictedPath: Array<[number, number]>;
  /** The vantage point while the follow flies to or searches from it. */
  vantage: [number, number] | null;
}

/**
 * The follow target on the tile map: null when the follow state is absent or
 * stale, follow-me is idle or holds for the operator, the target has no local
 * position, or the EKF origin is unknown.
 */
export function followTargetGeo(
  follow: FollowState | null,
  origin: { lat: number; lon: number } | null,
): FollowTargetGeo | null {
  const t = follow ? followSceneTarget(follow) : null;
  if (!t || !origin) return null;
  const geo = ([n, e]: readonly [number, number]) => nedToLatLon(origin, n, e);
  return {
    position: geo([t.north, t.east]),
    tick: t.velNorth !== null && t.velEast !== null ? geo([t.north + t.velNorth, t.east + t.velEast]) : null,
    dashed: t.dashed,
    searchRing: t.searchArea ? searchAreaRingNe(t.searchArea).map(geo) : null,
    predictedPath: (t.predictedPath ?? []).map(geo),
    vantage: t.vantageNe ? geo(t.vantageNe) : null,
  };
}
