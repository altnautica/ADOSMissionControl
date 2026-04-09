/**
 * Mission adherence — compare an actual flown path against an intended
 * mission's waypoint list.
 *
 * Computes:
 *   - waypointsReached: how many waypoints the actual path passed within
 *     a hit radius (15 m default).
 *   - maxCrossTrackErrorM: largest perpendicular distance from any path
 *     point to the closest mission leg.
 *   - meanCrossTrackErrorM: mean of the above.
 *   - deviationSegments: contiguous runs of path points where the error
 *     exceeded the deviation threshold (30 m default).
 *
 * Pure function — no I/O.
 *
 * @module flight-analysis/mission-adherence
 * @license GPL-3.0-only
 */

import type { MissionAdherence } from "@/lib/types";

const HIT_RADIUS_M = 15;
const DEVIATION_THRESHOLD_M = 30;
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

/**
 * Distance from a point to a great-circle leg, approximated as the
 * perpendicular distance to the chord in a local equirectangular plane.
 * Acceptable for the legs of typical drone missions (≤10 km).
 */
function pointToSegmentM(p: LatLon, a: LatLon, b: LatLon): number {
  // Project all three to a tangent plane centred on `a`.
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
  if (len2 === 0) return Math.sqrt(px * px + py * py);

  // Project p onto the segment, clamped to [0, 1].
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  const projX = ax + t * dx;
  const projY = ay + t * dy;
  const ex = px - projX;
  const ey = py - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Compute mission adherence stats. Returns null when there are fewer than
 * 2 waypoints (can't form a leg) or fewer than 2 path points.
 */
export function computeAdherence(
  path: [number, number][],
  waypoints: { lat: number; lon: number; alt: number }[],
): MissionAdherence | null {
  if (waypoints.length < 1) return null;
  if (path.length < 2) return null;

  // ── Waypoints reached ─────────────────────────────────────
  let reached = 0;
  for (const wp of waypoints) {
    for (const [pLat, pLon] of path) {
      if (haversineM({ lat: pLat, lon: pLon }, wp) <= HIT_RADIUS_M) {
        reached += 1;
        break;
      }
    }
  }

  // ── Cross-track error ─────────────────────────────────────
  // Need ≥ 2 waypoints to define a leg. With only 1 waypoint, we can't
  // compute cross-track — skip the rest and return what we have.
  if (waypoints.length < 2) {
    return {
      totalWaypoints: waypoints.length,
      waypointsReached: reached,
      maxCrossTrackErrorM: 0,
      meanCrossTrackErrorM: 0,
    };
  }

  let maxErr = 0;
  let sumErr = 0;
  const errors: number[] = new Array(path.length);

  for (let i = 0; i < path.length; i++) {
    const p: LatLon = { lat: path[i][0], lon: path[i][1] };
    let bestForPoint = Infinity;
    for (let j = 0; j < waypoints.length - 1; j++) {
      const d = pointToSegmentM(p, waypoints[j], waypoints[j + 1]);
      if (d < bestForPoint) bestForPoint = d;
    }
    errors[i] = bestForPoint;
    if (bestForPoint > maxErr) maxErr = bestForPoint;
    sumErr += bestForPoint;
  }
  const meanErr = sumErr / path.length;

  // ── Deviation segments ────────────────────────────────────
  const deviationSegments: NonNullable<MissionAdherence["deviationSegments"]> = [];
  let segStart = -1;
  let segMax = 0;
  for (let i = 0; i < errors.length; i++) {
    if (errors[i] > DEVIATION_THRESHOLD_M) {
      if (segStart === -1) {
        segStart = i;
        segMax = errors[i];
      } else if (errors[i] > segMax) {
        segMax = errors[i];
      }
    } else if (segStart !== -1) {
      deviationSegments.push({ startIdx: segStart, endIdx: i - 1, maxErrorM: Math.round(segMax) });
      segStart = -1;
      segMax = 0;
    }
  }
  if (segStart !== -1) {
    deviationSegments.push({
      startIdx: segStart,
      endIdx: errors.length - 1,
      maxErrorM: Math.round(segMax),
    });
  }

  return {
    totalWaypoints: waypoints.length,
    waypointsReached: reached,
    maxCrossTrackErrorM: Math.round(maxErr),
    meanCrossTrackErrorM: Math.round(meanErr),
    deviationSegments: deviationSegments.length > 0 ? deviationSegments : undefined,
  };
}
