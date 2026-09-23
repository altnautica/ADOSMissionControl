/**
 * Geofence forensics — walk a finalized flight path against the
 * snapshotted geofence configuration and emit breach segments.
 *
 * Inclusion zones are violated when the path is OUTSIDE.
 * Exclusion zones are violated when the path is INSIDE.
 * Altitude breaches use the flight's max altitude (per-point altitude
 * isn't carried in `record.path` and follow-up work may extend this
 * when 3D paths are added).
 *
 * Pure function — no I/O.
 *
 * @module flight-analysis/geofence-forensics
 * @license GPL-3.0-only
 */

import type { GeofenceBreach, GeofenceSnapshot } from "@/lib/types";
import { distanceToPolygonEdgeM, haversineDistance, pointInPolygon } from "@/lib/geo/distance";

interface PerPointBreach {
  zoneId: string;
  type: GeofenceBreach["type"];
  distance: number; // breach magnitude in meters; 0 means just-on-edge
}

/**
 * Walk a path against a geofence snapshot and emit breach runs.
 * Returns an empty array when the snapshot has no zones / not enabled.
 */
export function detectGeofenceBreaches(
  path: [number, number][],
  snapshot: GeofenceSnapshot | undefined,
  maxFlightAltM?: number,
): GeofenceBreach[] {
  if (!snapshot || !snapshot.enabled) return [];
  if (path.length < 2) return [];

  const zones = snapshot.zones ?? [];

  // ── Per-point per-zone classification ────────────────────
  // Each path index gets a list of zones it's currently breaching.
  const breachesPerIdx: PerPointBreach[][] = path.map(() => []);

  for (const zone of zones) {
    if (zone.type === "polygon" && zone.polygonPoints && zone.polygonPoints.length >= 3) {
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const inside = pointInPolygon(p, zone.polygonPoints);
        const isInclusion = zone.role === "inclusion";
        const isBreach = isInclusion ? !inside : inside;
        if (isBreach) {
          const dist = distanceToPolygonEdgeM(p, zone.polygonPoints);
          breachesPerIdx[i].push({
            zoneId: zone.id,
            type: isInclusion ? "polygon_outside" : "polygon_inside",
            distance: dist,
          });
        }
      }
    } else if (zone.type === "circle" && zone.circleCenter && zone.circleRadius) {
      const [cLat, cLon] = zone.circleCenter;
      const r = zone.circleRadius;
      for (let i = 0; i < path.length; i++) {
        const d = haversineDistance(path[i][0], path[i][1], cLat, cLon);
        const isInclusion = zone.role === "inclusion";
        const isBreach = isInclusion ? d > r : d <= r;
        if (isBreach) {
          breachesPerIdx[i].push({
            zoneId: zone.id,
            type: isInclusion ? "circle_outside" : "circle_inside",
            distance: isInclusion ? d - r : r - d,
          });
        }
      }
    }
  }

  // ── Merge into contiguous runs per (zoneId, type) ────────
  const result: GeofenceBreach[] = [];
  // Collect every distinct (zoneId, type) seen, then run a sweep per key.
  const keys = new Set<string>();
  for (const list of breachesPerIdx) {
    for (const b of list) keys.add(`${b.zoneId}|${b.type}`);
  }

  for (const key of keys) {
    const [zoneId, type] = key.split("|") as [string, GeofenceBreach["type"]];
    let runStart = -1;
    let runMax = 0;
    let runPeakIdx = -1;

    for (let i = 0; i < breachesPerIdx.length; i++) {
      const hit = breachesPerIdx[i].find((b) => b.zoneId === zoneId && b.type === type);
      if (hit) {
        if (runStart === -1) {
          runStart = i;
          runMax = hit.distance;
          runPeakIdx = i;
        } else if (hit.distance > runMax) {
          runMax = hit.distance;
          runPeakIdx = i;
        }
      } else if (runStart !== -1) {
        result.push({
          startIdx: runStart,
          endIdx: i - 1,
          type,
          zoneId,
          maxBreachDistanceM: Math.round(runMax),
          peakIdx: runPeakIdx,
        });
        runStart = -1;
        runMax = 0;
        runPeakIdx = -1;
      }
    }
    if (runStart !== -1) {
      result.push({
        startIdx: runStart,
        endIdx: breachesPerIdx.length - 1,
        type,
        zoneId,
        maxBreachDistanceM: Math.round(runMax),
        peakIdx: runPeakIdx,
      });
    }
  }

  // ── Altitude breaches ────────────────────────────────────
  if (typeof maxFlightAltM === "number" && maxFlightAltM > 0) {
    if (snapshot.maxAltitude !== undefined && maxFlightAltM > snapshot.maxAltitude) {
      result.push({
        startIdx: 0,
        endIdx: path.length - 1,
        type: "max_altitude",
        zoneId: "altitude",
        maxBreachDistanceM: Math.round(maxFlightAltM - snapshot.maxAltitude),
      });
    }
    // (Min altitude breaches require per-point alt; skip until we carry alt in path.)
  }

  return result;
}
