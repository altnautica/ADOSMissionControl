/**
 * @module validation/soft-geofence
 * @description Soft-buffer geofence warnings. Flags waypoints that lie INSIDE a
 * geofence but within a warning buffer of its boundary, so the operator sees the
 * plan approaching the hard limit before it actually breaches the fence. Pure
 * logic: no React, store, or map access, so it is directly unit-testable.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { distanceToPolygonEdgeM, haversineDistance, pointInPolygon } from "@/lib/geo/distance";

/** A geofence boundary: a polygon OR a circle. */
export interface SoftGeofence {
  /** Polygon boundary as [lat, lon] vertices (>= 3 for a usable fence). */
  polygonPoints?: [number, number][];
  /** Circle center as [lat, lon]. */
  circleCenter?: [number, number];
  /** Circle radius in meters (> 0 for a usable fence). */
  circleRadius?: number;
}

/** A single soft-buffer warning for a waypoint approaching the fence edge. */
export interface SoftBufferWarning {
  /** Index of the waypoint in the input array. */
  waypointIndex: number;
  /** Distance from the waypoint to the nearest fence boundary, in meters. */
  distanceToEdgeM: number;
  /** Human-readable warning message. */
  message: string;
}

/** Default warning buffer width in meters. */
export const DEFAULT_SOFT_BUFFER_M = 30;

/**
 * Warn about waypoints that are inside the fence but within `bufferM` meters of
 * its boundary. A waypoint outside the fence is a hard breach handled elsewhere
 * (mission-validator) and is never reported here. Returns one warning per
 * approaching waypoint, ordered by input index.
 *
 * @param waypoints Mission waypoints to check.
 * @param fence     Polygon or circle boundary.
 * @param bufferM   Warning buffer width in meters (defaults to 30). Values <= 0
 *                  disable the check and return no warnings.
 */
export function checkSoftBuffer(
  waypoints: readonly Waypoint[],
  fence: SoftGeofence,
  bufferM: number = DEFAULT_SOFT_BUFFER_M
): SoftBufferWarning[] {
  const warnings: SoftBufferWarning[] = [];
  if (!Number.isFinite(bufferM) || bufferM <= 0) return warnings;

  const polygon =
    fence.polygonPoints && fence.polygonPoints.length >= 3
      ? fence.polygonPoints
      : null;
  const hasCircle =
    !!fence.circleCenter &&
    typeof fence.circleRadius === "number" &&
    Number.isFinite(fence.circleRadius) &&
    fence.circleRadius > 0;

  if (!polygon && !hasCircle) return warnings;

  waypoints.forEach((wp, index) => {
    if (!Number.isFinite(wp.lat) || !Number.isFinite(wp.lon)) return;
    const point: [number, number] = [wp.lat, wp.lon];

    let inside = false;
    let distanceToEdgeM = Infinity;

    if (polygon) {
      if (pointInPolygon(point, polygon)) {
        inside = true;
        distanceToEdgeM = distanceToPolygonEdgeM(point, polygon);
      }
    } else if (hasCircle) {
      const [cLat, cLon] = fence.circleCenter as [number, number];
      const radius = fence.circleRadius as number;
      const distFromCenter = haversineDistance(wp.lat, wp.lon, cLat, cLon);
      if (distFromCenter < radius) {
        inside = true;
        distanceToEdgeM = radius - distFromCenter;
      }
    }

    if (inside && distanceToEdgeM <= bufferM) {
      const rounded = Math.round(distanceToEdgeM);
      warnings.push({
        waypointIndex: index,
        distanceToEdgeM,
        message: `WP${index + 1}: ${rounded}m from the geofence boundary (within the ${bufferM}m warning buffer)`,
      });
    }
  });

  return warnings;
}
