/**
 * @module patterns/vtol-landing-generator
 * @description VTOL landing pattern generator.
 *
 * Generates: approach waypoint → VTOL_LAND. The aircraft cruises in forward
 * flight to the approach waypoint at the approach altitude; VTOL_LAND then
 * makes the flight controller slow down, transition to hover and descend
 * vertically onto the landing point. No waypoint sits between the two, because
 * the flight controller flies every plain waypoint in forward flight: a low
 * waypoint over the landing point would be overflown at cruise speed.
 *
 * The vertical descent rate is the flight controller's own land-speed setting;
 * `descentSpeed` only feeds the time estimate.
 *
 * @license GPL-3.0-only
 */

import type { VtolLandingConfig, PatternResult, PatternWaypoint } from "./types";
import { offsetPoint } from "@/lib/drawing/geo-utils";
import { landingApproachHeading } from "./landing-generator";

const EMPTY_RESULT: PatternResult = {
  waypoints: [],
  stats: { totalDistance: 0, estimatedTime: 0, photoCount: 0, coveredArea: 0, transectCount: 0 },
};

export function generateVtolLanding(config: VtolLandingConfig): PatternResult {
  const {
    landingPoint, approachHeading, transitionDistance,
    approachAltitude, descentSpeed, speed,
  } = config;

  const heading = landingApproachHeading(approachHeading);
  if (!landingPoint || heading === null || !(transitionDistance > 0) || !(approachAltitude > 0)) {
    return EMPTY_RESULT;
  }

  // The approach start lies behind the landing point, opposite the final heading.
  const reverseHeading = (heading + 180) % 360;
  const approachStart = offsetPoint(landingPoint[0], landingPoint[1], reverseHeading, transitionDistance);

  const waypoints: PatternWaypoint[] = [
    // Cruise approach at full altitude.
    {
      lat: approachStart[0],
      lon: approachStart[1],
      alt: approachAltitude,
      speed,
      command: "WAYPOINT",
    },
    // Transition and vertical descent at the landing point. The leg into it
    // keeps the approach speed; the descent rate is the controller's own.
    {
      lat: landingPoint[0],
      lon: landingPoint[1],
      alt: 0,
      speed,
      command: "VTOL_LAND",
    },
  ];

  const cruiseTime = speed > 0 ? transitionDistance / speed : 0;
  const descentTime = descentSpeed > 0 ? approachAltitude / descentSpeed : 0;

  return {
    waypoints,
    previewLines: [
      [approachStart, [landingPoint[0], landingPoint[1]]],
    ],
    stats: {
      totalDistance: transitionDistance,
      estimatedTime: cruiseTime + descentTime,
      photoCount: 0,
      coveredArea: 0,
      transectCount: 0,
    },
  };
}
