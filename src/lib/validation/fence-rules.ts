/**
 * @module validation/fence-rules
 * @description Fence containment for waypoints and rally points: the primary
 * polygon or circle, inclusion and exclusion zones, and the fence polygon's
 * own shape. A rally point must be a safe return target, so it has to sit
 * inside every inclusion fence, outside every exclusion zone and under the
 * fence ceiling.
 *
 * @license GPL-3.0-only
 */

import type { FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { Waypoint } from "@/lib/types";
import { isSelfIntersecting } from "@/lib/drawing/geo-utils";
import { haversineDistance, pointInPolygon } from "@/lib/geo/distance";
import type { ValidationIssue, ValidationOptions } from "./issue-types";

type Fence = ValidationOptions["geofence"];

/**
 * Whether a point falls inside a fence zone (polygon or circle).
 * Returns false for a malformed zone (too few polygon points / no circle center).
 */
function pointInZone(lat: number, lon: number, zone: FenceZone): boolean {
  if (zone.type === "polygon") {
    if (zone.polygonPoints.length < 3) return false;
    return pointInPolygon([lat, lon], zone.polygonPoints);
  }
  if (!zone.circleCenter) return false;
  const dist = haversineDistance(lat, lon, zone.circleCenter[0], zone.circleCenter[1]);
  return dist <= zone.circleRadius;
}

/** Fence containment issues for one waypoint (all blocking). */
export function waypointFenceIssues(wp: Waypoint, i: number, fence: Fence): ValidationIssue[] {
  if (!fence) return [];
  const issues: ValidationIssue[] = [];
  const at = { severity: "blocking" as const, waypointIndex: i, waypointId: wp.id };

  if (fence.polygonPoints && fence.polygonPoints.length >= 3 && !pointInPolygon([wp.lat, wp.lon], fence.polygonPoints)) {
    issues.push({ ...at, code: "OUTSIDE_GEOFENCE", message: `WP${i + 1}: Outside geofence polygon`, text: { key: "wpOutsideGeofencePolygon", params: { v0: i + 1 } } });
  }
  if (fence.circleCenter && fence.circleRadius) {
    const dist = haversineDistance(wp.lat, wp.lon, fence.circleCenter[0], fence.circleCenter[1]);
    if (dist > fence.circleRadius) {
      issues.push({
        ...at,
        code: "OUTSIDE_GEOFENCE",
        message: `WP${i + 1}: ${Math.round(dist)}m from center, exceeds ${fence.circleRadius}m radius`,
        text: { key: "wpMFromCenterExceedsM", params: { v0: i + 1, v1: Math.round(dist), v2: fence.circleRadius } },
      });
    }
  }
  for (const zone of fence.zones ?? []) {
    const inside = pointInZone(wp.lat, wp.lon, zone);
    if (zone.role === "inclusion" && !inside) {
      issues.push({ ...at, code: "OUTSIDE_GEOFENCE", message: `WP${i + 1}: Outside inclusion zone`, text: { key: "wpOutsideInclusionZone", params: { v0: i + 1 } } });
    } else if (zone.role === "exclusion" && inside) {
      issues.push({ ...at, code: "INSIDE_EXCLUSION_ZONE", message: `WP${i + 1}: Inside a no-fly exclusion zone`, text: { key: "wpInsideANoFlyExclusion", params: { v0: i + 1 } } });
    }
  }
  return issues;
}

/** Fence items a fence upload writes: one per polygon vertex, one per circle. */
export function fenceItemCount(fence: Fence): number {
  if (!fence) return 0;
  let count = 0;
  if (fence.polygonPoints && fence.polygonPoints.length >= 3) count += fence.polygonPoints.length;
  if (fence.circleCenter) count += 1;
  for (const zone of fence.zones ?? []) {
    if (zone.type === "polygon") count += zone.polygonPoints.length >= 3 ? zone.polygonPoints.length : 0;
    else if (zone.circleCenter) count += 1;
  }
  return count;
}

/** Fence shape and rally point issues. */
export function fenceAndRallyIssues(
  fence: Fence,
  rallyPoints: readonly RallyPoint[],
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (fence?.polygonPoints && fence.polygonPoints.length >= 4 && isSelfIntersecting(fence.polygonPoints)) {
    warnings.push({
      severity: "advisory",
      code: "SELF_INTERSECTING_FENCE",
      message: "Geofence polygon is self-intersecting. Containment checks may be inaccurate.",
      text: { key: "geofencePolygonIsSelfIntersectingContainment" },
    });
  }

  for (let r = 0; r < rallyPoints.length; r++) {
    const rp = rallyPoints[r];
    if (rp.lat < -90 || rp.lat > 90 || rp.lon < -180 || rp.lon > 180) {
      errors.push({ severity: "blocking", code: "RALLY_INVALID_COORDS", message: `Rally ${r + 1}: Invalid coordinates`, text: { key: "rallyInvalidCoordinates", params: { v0: r + 1 } } });
      continue;
    }
    if (fence?.polygonPoints && fence.polygonPoints.length >= 3 && !pointInPolygon([rp.lat, rp.lon], fence.polygonPoints)) {
      errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside geofence polygon`, text: { key: "rallyOutsideGeofencePolygon", params: { v0: r + 1 } } });
    }
    if (fence?.circleCenter && fence.circleRadius) {
      const dist = haversineDistance(rp.lat, rp.lon, fence.circleCenter[0], fence.circleCenter[1]);
      if (dist > fence.circleRadius) {
        errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside geofence circle`, text: { key: "rallyOutsideGeofenceCircle", params: { v0: r + 1 } } });
      }
    }
    for (const zone of fence?.zones ?? []) {
      const inside = pointInZone(rp.lat, rp.lon, zone);
      if (zone.role === "inclusion" && !inside) {
        errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside inclusion zone`, text: { key: "rallyOutsideInclusionZone", params: { v0: r + 1 } } });
      } else if (zone.role === "exclusion" && inside) {
        errors.push({ severity: "blocking", code: "RALLY_INSIDE_EXCLUSION_ZONE", message: `Rally ${r + 1}: Inside a no-fly exclusion zone`, text: { key: "rallyInsideANoFlyExclusion", params: { v0: r + 1 } } });
      }
    }
    // A rally altitude is above home by definition, so it compares directly.
    if (fence?.maxAltitude !== undefined && fence.maxAltitude > 0 && rp.alt > fence.maxAltitude) {
      warnings.push({ severity: "advisory", code: "RALLY_ALTITUDE", message: `Rally ${r + 1}: Altitude ${rp.alt}m exceeds fence ceiling ${fence.maxAltitude}m`, text: { key: "rallyAltitudeMExceedsFenceCeiling", params: { v0: r + 1, v1: rp.alt, v2: fence.maxAltitude } } });
    }
  }
  return { errors, warnings };
}
