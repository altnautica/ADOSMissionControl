/**
 * Geofence forensics — walk a finalized flight path against the
 * snapshotted geofence configuration and emit breach segments.
 *
 * Inclusion zones are violated when the path is OUTSIDE.
 * Exclusion zones are violated when the path is INSIDE.
 * Altitude breaches use the flight's max altitude (per-point altitude
 * isn't carried in `record.path` — Phase 28 may extend this when 3D
 * paths are added).
 *
 * Pure function — no I/O.
 *
 * @module flight-analysis/geofence-forensics
 * @license GPL-3.0-only
 */

import type { GeofenceBreach, GeofenceSnapshot } from "@/lib/types";

const EARTH_RADIUS_M = 6_371_000;

interface LatLon {
  lat: number;
  lon: number;
}

function toRad(d: number): number {
  return (d * Math.PI) / 180;
}

function haversineM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(sa)));
}

/** Ray-casting point-in-polygon. Polygon is a [lat, lon][] ring. */
function pointInPolygon(p: LatLon, polygon: [number, number][]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0]; // lat
    const yi = polygon[i][1]; // lon
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    if (
      yi > p.lon !== yj > p.lon &&
      p.lat < ((xj - xi) * (p.lon - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/** Distance from a point to a polygon edge (in meters). 0 when inside. */
function distanceToPolygonEdgeM(p: LatLon, polygon: [number, number][]): number {
  if (polygon.length < 2) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a: LatLon = { lat: polygon[i][0], lon: polygon[i][1] };
    const b: LatLon = {
      lat: polygon[(i + 1) % polygon.length][0],
      lon: polygon[(i + 1) % polygon.length][1],
    };
    // Local equirectangular projection.
    const cosLat = Math.cos(toRad(a.lat));
    const ax = 0;
    const ay = 0;
    const bx = (b.lon - a.lon) * cosLat * 111_320;
    const by = (b.lat - a.lat) * 111_320;
    const px = (p.lon - a.lon) * cosLat * 111_320;
    const py = (p.lat - a.lat) * 111_320;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
      const d = Math.sqrt(px * px + py * py);
      if (d < best) best = d;
      continue;
    }
    const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
    const projX = t * dx;
    const projY = t * dy;
    const ex = px - projX;
    const ey = py - projY;
    const d = Math.sqrt(ex * ex + ey * ey);
    if (d < best) best = d;
  }
  return best;
}

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
        const p: LatLon = { lat: path[i][0], lon: path[i][1] };
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
      const center: LatLon = { lat: zone.circleCenter[0], lon: zone.circleCenter[1] };
      const r = zone.circleRadius;
      for (let i = 0; i < path.length; i++) {
        const p: LatLon = { lat: path[i][0], lon: path[i][1] };
        const d = haversineM(p, center);
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
