/**
 * @module nav/ned-geo
 * @description Local north/east metres → latitude/longitude about the EKF
 * origin, and the follow target placed on the global (tile) minimap. At the
 * ranges a follow target sits from its origin the spherical offset is exact
 * to well under a centimetre.
 *
 * @license GPL-3.0-only
 */

import type { FollowState } from "@/lib/agent/nav-types";
import { offsetPoint } from "@/lib/drawing/geo-utils";

/** `(north, east)` metres from `origin` as `[lat, lon]` degrees. */
export function nedToLatLon(origin: { lat: number; lon: number }, north: number, east: number): [number, number] {
  const distance = Math.hypot(north, east);
  if (distance === 0) return [origin.lat, origin.lon];
  const bearingDeg = (Math.atan2(east, north) * 180) / Math.PI;
  return offsetPoint(origin.lat, origin.lon, bearingDeg, distance);
}

export interface FollowTargetGeo {
  position: [number, number];
  /** Where the target will be in 1 s, or null without a velocity. */
  tick: [number, number] | null;
  /** Coasting / searching: drawn dashed in the coast colour. */
  dashed: boolean;
}

/**
 * The follow target on the tile map: null when the follow state is absent or
 * stale, the target has no local position, or the EKF origin is unknown.
 */
export function followTargetGeo(
  follow: FollowState | null,
  origin: { lat: number; lon: number } | null,
): FollowTargetGeo | null {
  if (!follow?.targetNed || !origin) return null;
  const [n, e] = follow.targetNed;
  const vel = follow.targetVelNed;
  return {
    position: nedToLatLon(origin, n, e),
    tick: vel ? nedToLatLon(origin, n + vel[0], e + vel[1]) : null,
    dashed: follow.phase === "coasting" || follow.phase === "searching",
  };
}
