/**
 * @module patterns/landing-generator
 * @description Fixed-wing landing pattern generator.
 *
 * Generates a straight-in approach: DO_LAND_START → approach waypoint → LAND.
 * The DO_LAND_START marker leads the sequence, so an RTL autoland (or a
 * go-around) that jumps to it flies the approach waypoint before the landing.
 * ArduPlane refuses to arm with a DO_LAND_START in the mission while
 * RTL_AUTOLAND is 0; the planner advisories flag that.
 *
 * ArduPlane descends linearly from the approach waypoint's altitude to the
 * touchdown point, so the glide slope flown is set by the geometry alone: the
 * approach waypoint sits `loiterAltitude / tan(glideSlopeAngle)` back from the
 * landing point along the reverse of the approach heading.
 *
 * @license GPL-3.0-only
 */

import type { FixedWingLandingConfig, PatternResult, PatternWaypoint } from "./types";
import { offsetPoint } from "@/lib/drawing/geo-utils";

const EMPTY_RESULT: PatternResult = {
  waypoints: [],
  stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
};

/**
 * A final-approach heading in degrees true, normalised to [0, 360), or `null`
 * when none has been chosen. The approach is flown along this heading, so there
 * is no stand-in value: an unset heading generates no landing.
 */
export function landingApproachHeading(heading: number | undefined): number | null {
  if (heading === undefined || !Number.isFinite(heading) || heading < 0 || heading > 360) return null;
  return heading % 360;
}

/**
 * Horizontal distance (m) from the approach waypoint to the touchdown point
 * that makes a descent from `altitude` follow `glideSlopeAngle` degrees, or
 * `null` when either value cannot describe a descent.
 */
export function fixedWingApproachDistance(altitude: number, glideSlopeAngle: number): number | null {
  if (!(altitude > 0) || !(glideSlopeAngle > 0) || !(glideSlopeAngle < 90)) return null;
  return altitude / Math.tan((glideSlopeAngle * Math.PI) / 180);
}

export function generateFixedWingLanding(config: FixedWingLandingConfig): PatternResult {
  const { landingPoint, approachHeading, glideSlopeAngle, loiterAltitude, speed } = config;

  const heading = landingApproachHeading(approachHeading);
  const approachDistance = fixedWingApproachDistance(loiterAltitude, glideSlopeAngle);
  if (!landingPoint || heading === null || approachDistance === null) return EMPTY_RESULT;

  // The approach start lies behind the landing point, opposite the final heading.
  const reverseHeading = (heading + 180) % 360;
  const approachStart = offsetPoint(landingPoint[0], landingPoint[1], reverseHeading, approachDistance);

  const waypoints: PatternWaypoint[] = [];

  // DO_LAND_START marker at the approach start. The FC picks the landing
  // sequence whose marker is closest and continues with the item after it.
  waypoints.push({
    lat: approachStart[0],
    lon: approachStart[1],
    alt: loiterAltitude,
    speed,
    command: "DO_LAND_START",
  });

  // Approach start at the approach altitude.
  waypoints.push({
    lat: approachStart[0],
    lon: approachStart[1],
    alt: loiterAltitude,
    speed,
    command: "WAYPOINT",
  });

  // LAND at the landing point.
  waypoints.push({
    lat: landingPoint[0],
    lon: landingPoint[1],
    alt: 0,
    speed,
    command: "LAND",
  });

  return {
    waypoints,
    previewLines: [
      [approachStart, [landingPoint[0], landingPoint[1]]],
    ],
    stats: {
      totalDistance: approachDistance,
      estimatedTime: speed > 0 ? approachDistance / speed : 0,
      photoCount: 0,
      coveredArea: 0,
      transectCount: 0,
    },
  };
}
