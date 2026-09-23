/**
 * @module patterns/orbit-generator
 * @description Generates circular orbit flight patterns around a point of interest.
 *
 * Algorithm:
 * 1. Compute circumference, determine number of waypoints (min 8, max 360, ~5m spacing)
 * 2. Place points equally spaced on the circle starting from startAngle
 * 3. Reverse order if direction is counter-clockwise
 * 4. Repeat for the requested number of turns
 * 5. Point the camera at the circle center with an ROI that rides the first
 *    orbit point (an action follows the navigation point it fires at). The
 *    ROI sits at the target's height, not the flight altitude, so the mount
 *    tilts down at the object instead of levelling at the horizon.
 *
 * @license GPL-3.0-only
 */

import type { OrbitConfig, PatternResult, PatternWaypoint } from "./types";
import { offsetPoint } from "@/lib/drawing/geo-utils";
import { haversineDistance } from "@/lib/geo/distance";

export function generateOrbit(config: OrbitConfig): PatternResult {
  const { center, radius, direction, turns, startAngle, altitude, speed, targetHeight = 0 } = config;

  if (radius <= 0 || turns <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  const circumference = 2 * Math.PI * radius;
  const spacing = 5; // meters between waypoints along the circle
  let pointsPerTurn = Math.round(circumference / spacing);
  pointsPerTurn = Math.max(8, Math.min(360, pointsPerTurn));

  const angleStep = 360 / pointsPerTurn;

  // Generate one orbit of points
  const singleOrbit: [number, number][] = [];
  for (let i = 0; i < pointsPerTurn; i++) {
    let angle = startAngle + i * angleStep;
    if (direction === "ccw") {
      angle = startAngle - i * angleStep;
    }
    // Normalize to 0-360
    angle = ((angle % 360) + 360) % 360;
    const pt = offsetPoint(center[0], center[1], angle, radius);
    singleOrbit.push(pt);
  }

  // Orbit points repeated for turns, with the ROI at the center right after
  // the first one so the drone points toward the POI for the whole orbit.
  const waypoints: PatternWaypoint[] = [];

  for (let t = 0; t < turns; t++) {
    for (const pt of singleOrbit) {
      waypoints.push({
        lat: pt[0],
        lon: pt[1],
        alt: altitude,
        speed,
        command: "WAYPOINT",
      });
      if (waypoints.length === 1) {
        waypoints.push({ lat: center[0], lon: center[1], alt: targetHeight, speed, command: "ROI" });
      }
    }
  }

  // Stats
  let totalDistance = 0;
  const wpOnly = waypoints.filter((w) => w.command === "WAYPOINT");
  for (let i = 1; i < wpOnly.length; i++) {
    totalDistance += haversineDistance(
      wpOnly[i - 1].lat, wpOnly[i - 1].lon,
      wpOnly[i].lat, wpOnly[i].lon
    );
  }
  // Add closing segment (last point back to first for the loop)
  if (wpOnly.length > 1) {
    totalDistance += haversineDistance(
      wpOnly[wpOnly.length - 1].lat, wpOnly[wpOnly.length - 1].lon,
      wpOnly[0].lat, wpOnly[0].lon
    );
  }

  const coveredArea = Math.PI * radius * radius;
  const estimatedTime = speed > 0 ? totalDistance / speed : 0;

  return {
    waypoints,
    stats: {
      totalDistance,
      estimatedTime,
      photoCount: 0,
      coveredArea,
      transectCount: 0,
    },
  };
}
