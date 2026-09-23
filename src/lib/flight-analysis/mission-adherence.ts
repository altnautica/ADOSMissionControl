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
import { haversineDistance, pointToSegmentM } from "@/lib/geo/distance";

const HIT_RADIUS_M = 15;
const DEVIATION_THRESHOLD_M = 30;

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
      if (haversineDistance(pLat, pLon, wp.lat, wp.lon) <= HIT_RADIUS_M) {
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

  const legs = waypoints.map((wp): [number, number] => [wp.lat, wp.lon]);
  for (let i = 0; i < path.length; i++) {
    let bestForPoint = Infinity;
    for (let j = 0; j < legs.length - 1; j++) {
      const d = pointToSegmentM(path[i], legs[j], legs[j + 1]);
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
