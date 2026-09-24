/**
 * @module validation/leg-fence
 * @description Whether a straight mission leg crosses a fence boundary. A
 * waypoint-only containment check passes a leg whose two ends sit inside a
 * non-convex inclusion fence but whose straight line cuts outside it, or whose
 * two ends sit outside a no-fly zone while the line between them runs through
 * it. The vehicle flies the line, so the line is what has to be checked.
 *
 * Geometry runs in a local equirectangular plane centred on the leg's start,
 * which is exact enough for mission-scale legs and fence edges.
 * @license GPL-3.0-only
 */

import { haversineDistance, lonDelta, pointInPolygon, pointToSegmentM } from "@/lib/geo/distance";
import type { FenceZone } from "@/stores/geofence-store";
import type { Waypoint } from "@/lib/types";
import type { ValidationIssue } from "./mission-validator";

type LatLon = readonly [number, number];

/** Metres per degree of latitude (and of longitude at the equator). */
const M_PER_DEG = 111_320;

/** Project `p` into the local plane centred on `origin` (x east, y north, metres). */
function project(origin: LatLon, p: LatLon, cosLat: number): [number, number] {
  return [lonDelta(origin[1], p[1]) * cosLat * M_PER_DEG, (p[0] - origin[0]) * M_PER_DEG];
}

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Proper or touching intersection of segments p1-p2 and q1-q2. */
function segmentsIntersect(
  p1: [number, number],
  p2: [number, number],
  q1: [number, number],
  q2: [number, number],
): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * True when the straight leg `a`→`b` crosses any edge of the closed polygon
 * ring. A leg that only touches a vertex tangentially does not count.
 */
export function legCrossesPolygon(a: LatLon, b: LatLon, polygon: readonly LatLon[]): boolean {
  if (polygon.length < 3) return false;
  const cosLat = Math.cos((a[0] * Math.PI) / 180);
  const pa: [number, number] = [0, 0];
  const pb = project(a, b, cosLat);
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (segmentsIntersect(pa, pb, project(a, polygon[j], cosLat), project(a, polygon[i], cosLat))) {
      return true;
    }
  }
  return false;
}

/** True when the straight leg `a`→`b` passes within `radiusM` of `center`. */
export function legEntersCircle(a: LatLon, b: LatLon, center: LatLon, radiusM: number): boolean {
  return pointToSegmentM(center, a, b) <= radiusM;
}

/** The fences the leg rule checks: the primary polygon and the zones. */
export interface LegFences {
  polygonPoints?: [number, number][];
  zones?: FenceZone[];
}

/**
 * Blocking issues for the leg from `prev` into `wp` (index `i`). Only the
 * crossing a waypoint check cannot see is reported: both ends inside an
 * inclusion polygon while the line leaves it, or both ends outside a no-fly
 * zone while the line runs through it. An end on the wrong side is already a
 * waypoint issue.
 */
export function legFenceIssues(
  prev: Waypoint,
  wp: Waypoint,
  i: number,
  fences: LegFences | undefined,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const a: [number, number] = [prev.lat, prev.lon];
  const b: [number, number] = [wp.lat, wp.lon];
  const leaves = (polygon: readonly [number, number][]) =>
    polygon.length >= 3 &&
    pointInPolygon(a, polygon) &&
    pointInPolygon(b, polygon) &&
    legCrossesPolygon(a, b, polygon);
  const outside = {
    severity: "blocking" as const,
    code: "LEG_OUTSIDE_GEOFENCE",
    message: `WP${i} to WP${i + 1}: the straight leg leaves the geofence`,
    waypointIndex: i,
    waypointId: wp.id,
  };

  if (fences?.polygonPoints && leaves(fences.polygonPoints)) issues.push(outside);
  for (const zone of fences?.zones ?? []) {
    if (zone.role === "inclusion") {
      if (zone.type === "polygon" && leaves(zone.polygonPoints)) issues.push(outside);
      continue;
    }
    const entersZone =
      zone.type === "polygon"
        ? zone.polygonPoints.length >= 3 &&
          !pointInPolygon(a, zone.polygonPoints) &&
          !pointInPolygon(b, zone.polygonPoints) &&
          legCrossesPolygon(a, b, zone.polygonPoints)
        : !!zone.circleCenter &&
          haversineDistance(a[0], a[1], zone.circleCenter[0], zone.circleCenter[1]) > zone.circleRadius &&
          haversineDistance(b[0], b[1], zone.circleCenter[0], zone.circleCenter[1]) > zone.circleRadius &&
          legEntersCircle(a, b, zone.circleCenter, zone.circleRadius);
    if (entersZone) {
      issues.push({
        severity: "blocking",
        code: "LEG_CROSSES_EXCLUSION_ZONE",
        message: `WP${i} to WP${i + 1}: the straight leg crosses a no-fly exclusion zone`,
        waypointIndex: i,
        waypointId: wp.id,
      });
    }
  }
  return issues;
}
