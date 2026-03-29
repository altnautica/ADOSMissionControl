/**
 * @module patterns/landing-generator
 * @description Fixed-wing landing pattern generator.
 *
 * Generates an approach sequence: approach waypoint → DO_LAND_START → loiter → LAND.
 * The approach start is calculated by projecting backward from the landing point
 * along the reverse approach heading.
 *
 * @license GPL-3.0-only
 */

import type { FixedWingLandingConfig, PatternResult, PatternWaypoint } from "./types";
import { offsetPoint, haversineDistance } from "@/lib/drawing/geo-utils";

export function generateFixedWingLanding(config: FixedWingLandingConfig): PatternResult {
  const {
    landingPoint, approachHeading, approachDistance,
    glideSlopeAngle, loiterAltitude, speed,
  } = config;

  if (!landingPoint || approachDistance <= 0 || loiterAltitude <= 0) {
    return { waypoints: [], stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 } };
  }

  // Calculate approach start: project backward from landing point
  const heading = approachHeading >= 0 ? approachHeading : 0;
  const reverseHeading = (heading + 180) % 360;
  const approachStart = offsetPoint(landingPoint[0], landingPoint[1], reverseHeading, approachDistance);

  const waypoints: PatternWaypoint[] = [];

  // WP1: Approach start at loiter altitude
  waypoints.push({
    lat: approachStart[0],
    lon: approachStart[1],
    alt: loiterAltitude,
    speed,
    command: "WAYPOINT",
  });

  // WP2: DO_LAND_START marker (same position, signals FC that landing begins)
  waypoints.push({
    lat: approachStart[0],
    lon: approachStart[1],
    alt: loiterAltitude,
    speed,
    command: "DO_LAND_START",
  });

  // WP3: LAND at landing point
  waypoints.push({
    lat: landingPoint[0],
    lon: landingPoint[1],
    alt: 0,
    speed,
    command: "LAND",
  });

  // Stats
  const totalDistance = haversineDistance(approachStart[0], approachStart[1], landingPoint[0], landingPoint[1]);
  const descentRate = speed * Math.sin((glideSlopeAngle * Math.PI) / 180);
  const estimatedTime = speed > 0 ? totalDistance / speed : 0;

  return {
    waypoints,
    previewLines: [
      [approachStart, [landingPoint[0], landingPoint[1]]],
    ],
    stats: {
      totalDistance,
      estimatedTime,
      photoCount: 0,
      coveredArea: 0,
      transectCount: 0,
    },
  };
}
