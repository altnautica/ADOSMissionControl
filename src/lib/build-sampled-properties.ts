/**
 * @module build-sampled-properties
 * @description Builds CesiumJS SampledPositionProperty + SampledProperty<heading>
 * from a flight plan. Pure function — no React, no side effects.
 * @license GPL-3.0-only
 */

import {
  JulianDate,
  SampledPositionProperty,
  SampledProperty,
  LinearApproximation,
  Cartesian3,
  Math as CesiumMath,
} from "cesium";
import type { Waypoint } from "@/lib/types";
import type { FlightPlan, SimPoint } from "@/lib/simulation-utils";

export interface SampledProperties {
  sampledPosition: SampledPositionProperty;
  sampledHeading: SampledProperty;
  startJulian: JulianDate;
}

// Scratch JulianDate reused for intermediate computations to reduce allocations
const _scratch = new JulianDate();

/**
 * Compute cumulative Cartesian3 distances between consecutive positions.
 * Returns array of length positions.length where [0] = 0.
 */
function cumulativeDistances(positions: Cartesian3[]): number[] {
  const dists = [0];
  for (let i = 1; i < positions.length; i++) {
    dists.push(dists[i - 1] + Cartesian3.distance(positions[i - 1], positions[i]));
  }
  return dists;
}

/**
 * Build CesiumJS sampled properties from waypoints and a computed flight plan,
 * one leg per flight-plan segment (an RTL flies several legs home; action
 * items fly none).
 *
 * A leg end that is an item's own position uses that item's terrain-resolved
 * position when `waypointPositions` is given. A leg end the plan resolved
 * elsewhere (RTL's climb and home, a positionless item) is its relative
 * altitude over `homeHeight`. When allPositions + waypointIndices are provided
 * (from resolveAGLToAbsolute), a leg between adjacent items also gets the
 * terrain-following sub-samples between them, with travel time distributed by
 * distance so the drone follows the contour instead of cutting through hills.
 *
 * Returns null if there are no waypoints or segments.
 */
export function buildSampledProperties(
  waypoints: Waypoint[],
  flightPlan: FlightPlan,
  waypointPositions?: Cartesian3[],
  allPositions?: Cartesian3[],
  waypointIndices?: number[],
  homeHeight = 0,
): SampledProperties | null {
  if (waypoints.length === 0 || flightPlan.segments.length === 0) return null;

  const startJulian = JulianDate.fromDate(new Date(0)); // Arbitrary epoch
  const sampledPosition = new SampledPositionProperty();
  const sampledHeading = new SampledProperty(Number);

  // Linear interpolation — drone flies in straight lines between samples
  sampledPosition.setInterpolationOptions({
    interpolationAlgorithm: LinearApproximation,
    interpolationDegree: 1,
  });
  sampledHeading.setInterpolationOptions({
    interpolationAlgorithm: LinearApproximation,
    interpolationDegree: 1,
  });

  const isItemPoint = (point: SimPoint, index: number) => {
    const wp = waypoints[index];
    return point.lat === wp.lat && point.lon === wp.lon && point.alt === wp.alt;
  };
  const positionOf = (point: SimPoint, index: number): Cartesian3 =>
    isItemPoint(point, index)
      ? waypointPositions?.[index] ?? Cartesian3.fromDegrees(point.lon, point.lat, point.alt)
      : Cartesian3.fromDegrees(point.lon, point.lat, point.alt + homeHeight);

  let t = JulianDate.clone(startJulian);
  const { segments } = flightPlan;

  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const hdgRad = -CesiumMath.toRadians(seg.heading);
    const fromPos = positionOf(seg.from, seg.fromIndex);

    if (k === 0) {
      sampledPosition.addSample(JulianDate.clone(t), fromPos);
    }
    sampledHeading.addSample(JulianDate.clone(t), hdgRad);

    if (seg.holdTime > 0) {
      // Duplicate position at departure = drone holds in place
      t = JulianDate.addSeconds(t, seg.holdTime, _scratch);
      t = JulianDate.clone(t);
      sampledPosition.addSample(JulianDate.clone(t), fromPos);
      sampledHeading.addSample(JulianDate.clone(t), hdgRad);
    }

    const travelTime = seg.duration - seg.holdTime;
    const toPos = positionOf(seg.to, seg.toIndex);
    if (travelTime > 0) {
      const adjacentItems =
        seg.toIndex === seg.fromIndex + 1 &&
        isItemPoint(seg.from, seg.fromIndex) &&
        isItemPoint(seg.to, seg.toIndex);
      if (allPositions && waypointIndices && adjacentItems) {
        const segPositions = allPositions.slice(
          waypointIndices[seg.fromIndex],
          waypointIndices[seg.toIndex] + 1,
        );
        if (segPositions.length > 2) {
          // Distribute travel time proportionally by distance
          const cumDists = cumulativeDistances(segPositions);
          const totalDist = cumDists[cumDists.length - 1];
          // Skip first (the leg start) and last (the arrival sample below)
          for (let j = 1; j < segPositions.length - 1; j++) {
            const frac = totalDist > 0 ? cumDists[j] / totalDist : j / (segPositions.length - 1);
            const intermediateT = JulianDate.addSeconds(t, travelTime * frac, _scratch);
            sampledPosition.addSample(JulianDate.clone(intermediateT), segPositions[j]);
            sampledHeading.addSample(JulianDate.clone(intermediateT), hdgRad);
          }
        }
      }
      // Heading sample just before arrival to prevent blending across legs
      const almostArrival = JulianDate.addSeconds(t, travelTime - 0.001, _scratch);
      sampledHeading.addSample(JulianDate.clone(almostArrival), hdgRad);
      t = JulianDate.addSeconds(t, travelTime, _scratch);
      t = JulianDate.clone(t);
    }
    sampledPosition.addSample(JulianDate.clone(t), toPos);
  }

  // The final item's hold, as the flight plan counts it
  const last = segments[segments.length - 1];
  const finalHold = flightPlan.totalDuration - last.cumulativeDuration;
  if (finalHold > 0) {
    t = JulianDate.addSeconds(t, finalHold, _scratch);
    t = JulianDate.clone(t);
    sampledPosition.addSample(JulianDate.clone(t), positionOf(last.to, last.toIndex));
    sampledHeading.addSample(JulianDate.clone(t), -CesiumMath.toRadians(last.heading));
  }

  return { sampledPosition, sampledHeading, startJulian };
}
