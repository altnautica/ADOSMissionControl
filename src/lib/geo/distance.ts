/**
 * @module geo/distance
 * @description The one home for ground distance on a spherical Earth: the
 * haversine great-circle distance, the point-to-segment and point-to-edge
 * distances in a local equirectangular plane, and the ray-casting
 * point-in-polygon test. Points are `[lat, lon]` degrees.
 * @license GPL-3.0-only
 */

/** Mean Earth radius in metres. */
export const EARTH_RADIUS_M = 6_371_000;

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres between two points (haversine). */
export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Longitude difference `toLon - fromLon` in degrees, wrapped into [-180, 180)
 * so a leg across the antimeridian takes the short way round instead of
 * sweeping 358 degrees the other way.
 */
export function lonDelta(fromLon: number, toLon: number): number {
  return ((((toLon - fromLon) % 360) + 540) % 360) - 180;
}

/** A longitude folded back into [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * The point a fraction `t` of the way from `a` to `b`, interpolated linearly in
 * latitude/longitude (adequate for mission legs), with the longitude taking the
 * short way across the antimeridian and normalised back into [-180, 180).
 */
export function interpolateLatLon(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  t: number,
): { lat: number; lon: number } {
  return {
    lat: aLat + (bLat - aLat) * t,
    lon: normalizeLon(aLon + lonDelta(aLon, bLon) * t),
  };
}

/**
 * Distance in metres from `p` to the segment `a`-`b`, measured in a local
 * equirectangular plane centred on `a`. Accurate for the short legs and fence
 * edges of drone missions (well under 10 km).
 */
export function pointToSegmentM(
  p: readonly [number, number],
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  const cosLat = Math.cos(toRad(a[0]));
  const bx = lonDelta(a[1], b[1]) * cosLat * M_PER_DEG;
  const by = (b[0] - a[0]) * M_PER_DEG;
  const px = lonDelta(a[1], p[1]) * cosLat * M_PER_DEG;
  const py = (p[0] - a[0]) * M_PER_DEG;
  const len2 = bx * bx + by * by;
  if (len2 === 0) return Math.hypot(px, py);
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / len2));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Smallest distance in metres from `point` to any edge of the closed ring. */
export function distanceToPolygonEdgeM(
  point: readonly [number, number],
  polygon: readonly [number, number][],
): number {
  let min = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const d = pointToSegmentM(point, polygon[j], polygon[i]);
    if (d < min) min = d;
  }
  return min;
}

/** Ray-casting point-in-polygon test. */
export function pointInPolygon(
  point: readonly [number, number],
  polygon: readonly [number, number][],
): boolean {
  const [py, px] = point;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [iy, ix] = polygon[i];
    const [jy, jx] = polygon[j];
    if (iy > py !== jy > py && px < ((jx - ix) * (py - iy)) / (jy - iy) + ix) {
      inside = !inside;
    }
  }
  return inside;
}
