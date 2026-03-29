/**
 * @module patterns/vtol-landing-generator
 * @description VTOL landing pattern generator.
 *
 * Generates: approach waypoint → transition hover point → descent waypoints → VTOL_LAND.
 * The drone cruises to the transition point, then descends vertically to land.
 *
 * @license GPL-3.0-only
 */

import type { VtolLandingConfig, PatternResult, PatternWaypoint } from "./types";
import { offsetPoint, haversineDistance } from "@/lib/drawing/geo-utils";

export function generateVtolLanding(config: VtolLandingConfig): PatternResult {
  const {
    landingPoint, approachHeading, transitionDistance,
    approachAltitude, descentSpeed, speed,
  } = config;

  if (!landingPoint || transitionDistance <= 0 || approachAltitude <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Calculate approach start: project backward from landing point
  const heading = approachHeading >= 0 ? approachHeading : 0;
  const reverseHeading = (heading + 180) % 360;
  const approachStart = offsetPoint(landingPoint[0], landingPoint[1], reverseHeading, transitionDistance);

  // Midpoint for gradual descent
  const midLat = (approachStart[0] + landingPoint[0]) / 2;
  const midLon = (approachStart[1] + landingPoint[1]) / 2;

  const waypoints: PatternWaypoint[] = [];

  // WP1: Approach start at full altitude (cruise approach)
  waypoints.push({
    lat: approachStart[0],
    lon: approachStart[1],
    alt: approachAltitude,
    speed,
    command: "WAYPOINT",
  });

  // WP2: Midpoint — begin descent (60% altitude)
  waypoints.push({
    lat: midLat,
    lon: midLon,
    alt: Math.round(approachAltitude * 0.6),
    speed: Math.max(speed * 0.5, 2),
    command: "WAYPOINT",
  });

  // WP3: Near landing point — low hover (10m or 20% of approach alt, whichever is higher)
  const hoverAlt = Math.max(10, Math.round(approachAltitude * 0.2));
  waypoints.push({
    lat: landingPoint[0],
    lon: landingPoint[1],
    alt: hoverAlt,
    speed: 2,
    command: "WAYPOINT",
  });

  // WP4: VTOL_LAND at landing point
  waypoints.push({
    lat: landingPoint[0],
    lon: landingPoint[1],
    alt: 0,
    speed: descentSpeed,
    command: "VTOL_LAND",
  });

  // Stats
  const cruiseDistance = haversineDistance(approachStart[0], approachStart[1], landingPoint[0], landingPoint[1]);
  const descentTime = approachAltitude / descentSpeed;
  const cruiseTime = speed > 0 ? cruiseDistance / speed : 0;
  const estimatedTime = cruiseTime + descentTime;

  return {
    waypoints,
    previewLines: [
      [approachStart, [midLat, midLon]],
      [[midLat, midLon], [landingPoint[0], landingPoint[1]]],
    ],
    stats: {
      totalDistance: cruiseDistance,
      estimatedTime,
      photoCount: 0,
      coveredArea: 0,
      transectCount: 0,
    },
  };
}
