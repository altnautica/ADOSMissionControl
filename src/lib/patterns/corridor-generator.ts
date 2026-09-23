/**
 * @module patterns/corridor-generator
 * @description Generates corridor scan flight patterns along a path center line.
 *
 * Algorithm:
 * 1. For each segment of the center-line path, compute left and right offset lines
 * 2. Build a corridor boundary polygon from the offset lines
 * 3. Generate perpendicular transects at lineSpacing intervals along the path
 * 4. Clip transects to the corridor boundary
 * 5. Connect transects in boustrophedon (serpentine) order
 *
 * @license GPL-3.0-only
 */

import type { CorridorConfig, PatternResult, PatternWaypoint } from "./types";
import {
  bearing,
  offsetPoint,
  polygonArea,
} from "@/lib/drawing/geo-utils";
import { haversineDistance } from "@/lib/geo/distance";

export function generateCorridor(config: CorridorConfig): PatternResult {
  const { pathPoints, corridorWidth, lineSpacing, altitude, speed } = config;

  if (pathPoints.length < 2 || corridorWidth <= 0 || lineSpacing <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  const halfWidth = corridorWidth / 2;

  // Build corridor boundary by offsetting each path segment left and right.
  // Left side follows the path forward, right side follows it backward (to form a closed polygon).
  const leftBoundary: [number, number][] = [];
  const rightBoundary: [number, number][] = [];

  for (let i = 0; i < pathPoints.length; i++) {
    // Compute the average bearing at this point
    let brng: number;
    if (i === 0) {
      brng = bearing(pathPoints[0][0], pathPoints[0][1], pathPoints[1][0], pathPoints[1][1]);
    } else if (i === pathPoints.length - 1) {
      brng = bearing(
        pathPoints[i - 1][0], pathPoints[i - 1][1],
        pathPoints[i][0], pathPoints[i][1]
      );
    } else {
      const b1 = bearing(pathPoints[i - 1][0], pathPoints[i - 1][1], pathPoints[i][0], pathPoints[i][1]);
      const b2 = bearing(pathPoints[i][0], pathPoints[i][1], pathPoints[i + 1][0], pathPoints[i + 1][1]);
      // Average bearing (handle wrap-around)
      const dx = Math.cos(b1 * Math.PI / 180) + Math.cos(b2 * Math.PI / 180);
      const dy = Math.sin(b1 * Math.PI / 180) + Math.sin(b2 * Math.PI / 180);
      brng = ((Math.atan2(dy, dx) * 180 / Math.PI) % 360 + 360) % 360;
    }

    // Left = bearing - 90, Right = bearing + 90
    const leftBrng = ((brng - 90) % 360 + 360) % 360;
    const rightBrng = ((brng + 90) % 360 + 360) % 360;

    leftBoundary.push(offsetPoint(pathPoints[i][0], pathPoints[i][1], leftBrng, halfWidth));
    rightBoundary.push(offsetPoint(pathPoints[i][0], pathPoints[i][1], rightBrng, halfWidth));
  }

  // Compute total path length for transect spacing
  let totalPathLength = 0;
  const segmentLengths: number[] = [];
  for (let i = 1; i < pathPoints.length; i++) {
    const d = haversineDistance(
      pathPoints[i - 1][0], pathPoints[i - 1][1],
      pathPoints[i][0], pathPoints[i][1]
    );
    segmentLengths.push(d);
    totalPathLength += d;
  }

  // Generate perpendicular transects at lineSpacing intervals along the path
  const transects: { left: [number, number]; right: [number, number] }[] = [];

  let distanceCovered = 0;
  let nextTransectAt = 0;
  let segIdx = 0;
  let segProgress = 0; // distance into current segment

  while (nextTransectAt <= totalPathLength && segIdx < segmentLengths.length) {
    // Find the point along the path at nextTransectAt
    while (segIdx < segmentLengths.length && segProgress + segmentLengths[segIdx] < nextTransectAt) {
      segProgress += segmentLengths[segIdx];
      segIdx++;
    }
    if (segIdx >= segmentLengths.length) break;

    const segLen = segmentLengths[segIdx];
    const t = segLen > 0 ? (nextTransectAt - segProgress) / segLen : 0;

    // Interpolate position along the segment
    const lat = pathPoints[segIdx][0] + t * (pathPoints[segIdx + 1][0] - pathPoints[segIdx][0]);
    const lon = pathPoints[segIdx][1] + t * (pathPoints[segIdx + 1][1] - pathPoints[segIdx][1]);

    // Perpendicular bearing
    const segBrng = bearing(
      pathPoints[segIdx][0], pathPoints[segIdx][1],
      pathPoints[segIdx + 1][0], pathPoints[segIdx + 1][1]
    );
    const leftBrng = ((segBrng - 90) % 360 + 360) % 360;
    const rightBrng = ((segBrng + 90) % 360 + 360) % 360;

    transects.push({
      left: offsetPoint(lat, lon, leftBrng, halfWidth),
      right: offsetPoint(lat, lon, rightBrng, halfWidth),
    });

    nextTransectAt += lineSpacing;
  }

  if (transects.length === 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Connect in boustrophedon order
  const waypoints: PatternWaypoint[] = [];
  const previewLines: [[number, number], [number, number]][] = [];

  for (let i = 0; i < transects.length; i++) {
    const t = transects[i];
    const startFromLeft = i % 2 === 0;
    const start = startFromLeft ? t.left : t.right;
    const end = startFromLeft ? t.right : t.left;

    previewLines.push([start, end]);

    waypoints.push({
      lat: start[0],
      lon: start[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });

    waypoints.push({
      lat: end[0],
      lon: end[1],
      alt: altitude,
      speed,
      command: "WAYPOINT",
    });
  }

  // Stats
  let flightDistance = 0;
  for (let i = 1; i < waypoints.length; i++) {
    flightDistance += haversineDistance(
      waypoints[i - 1].lat, waypoints[i - 1].lon,
      waypoints[i].lat, waypoints[i].lon
    );
  }

  // Corridor area approximation
  const corridorBoundary: [number, number][] = [
    ...leftBoundary,
    ...rightBoundary.slice().reverse(),
  ];
  const coveredArea = polygonArea(corridorBoundary);
  const estimatedTime = speed > 0 ? flightDistance / speed : 0;

  return {
    waypoints,
    stats: {
      totalDistance: flightDistance,
      estimatedTime,
      photoCount: 0,
      coveredArea,
      transectCount: transects.length,
    },
    previewLines,
  };
}
