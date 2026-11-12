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
  Cartographic,
  Cartesian3,
  Math as CesiumMath,
} from "cesium";
import type { Waypoint } from "@/lib/types";
import type { FlightPlan, SimPoint } from "@/lib/simulation-utils";

export interface SampledProperties {
  sampledPosition: SampledPositionProperty;
  sampledHeading: SampledProperty;
  /** Height above the ground under the drone (m), sampled with the position. */
  sampledAgl: SampledProperty;
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
 * `sampledAgl` carries the height above ground at every position sample. With
 * `groundHeights` (the sampled terrain under each of `allPositions`) a resolved
 * position's AGL is its height over that ground; any other leg end carries its
 * planned altitude. The HUD reads it instead of asking the rendered globe,
 * whose coarse first tiles sit kilometres below the real ground.
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
  groundHeights?: number[],
): SampledProperties | null {
  if (waypoints.length === 0 || flightPlan.segments.length === 0) return null;

  const startJulian = JulianDate.fromDate(new Date(0)); // Arbitrary epoch
  const sampledPosition = new SampledPositionProperty();
  const sampledHeading = new SampledProperty(Number);
  const sampledAgl = new SampledProperty(Number);

  // Linear interpolation — drone flies in straight lines between samples
  sampledPosition.setInterpolationOptions({
    interpolationAlgorithm: LinearApproximation,
    interpolationDegree: 1,
  });
  sampledHeading.setInterpolationOptions({
    interpolationAlgorithm: LinearApproximation,
    interpolationDegree: 1,
  });
  sampledAgl.setInterpolationOptions({
    interpolationAlgorithm: LinearApproximation,
    interpolationDegree: 1,
  });

  const isItemPoint = (point: SimPoint, index: number) => {
    const wp = waypoints[index];
    return point.lat === wp.lat && point.lon === wp.lon && point.alt === wp.alt;
  };
  /** Height of `pos` above the ground at path sample `pathIndex`, when both are known. */
  const aglAtPathIndex = (pos: Cartesian3, pathIndex: number | undefined): number | undefined => {
    const ground = pathIndex === undefined ? undefined : groundHeights?.[pathIndex];
    return ground === undefined ? undefined : Cartographic.fromCartesian(pos).height - ground;
  };
  const sampleOf = (point: SimPoint, index: number): { pos: Cartesian3; agl: number } => {
    if (isItemPoint(point, index)) {
      const resolved = waypointPositions?.[index];
      if (resolved) {
        return { pos: resolved, agl: aglAtPathIndex(resolved, waypointIndices?.[index]) ?? point.alt };
      }
      return { pos: Cartesian3.fromDegrees(point.lon, point.lat, point.alt), agl: point.alt };
    }
    return { pos: Cartesian3.fromDegrees(point.lon, point.lat, point.alt + homeHeight), agl: point.alt };
  };
  const addPosition = (time: JulianDate, sample: { pos: Cartesian3; agl: number }) => {
    sampledPosition.addSample(JulianDate.clone(time), sample.pos);
    sampledAgl.addSample(JulianDate.clone(time), sample.agl);
  };

  let t = JulianDate.clone(startJulian);
  const { segments } = flightPlan;

  for (let k = 0; k < segments.length; k++) {
    const seg = segments[k];
    const hdgRad = -CesiumMath.toRadians(seg.heading);
    const from = sampleOf(seg.from, seg.fromIndex);

    if (k === 0) {
      addPosition(t, from);
    }
    sampledHeading.addSample(JulianDate.clone(t), hdgRad);

    if (seg.holdTime > 0) {
      // Duplicate position at departure = drone holds in place
      t = JulianDate.addSeconds(t, seg.holdTime, _scratch);
      t = JulianDate.clone(t);
      addPosition(t, from);
      sampledHeading.addSample(JulianDate.clone(t), hdgRad);
    }

    const travelTime = seg.duration - seg.holdTime;
    const to = sampleOf(seg.to, seg.toIndex);
    if (travelTime > 0) {
      const adjacentItems =
        seg.toIndex === seg.fromIndex + 1 &&
        isItemPoint(seg.from, seg.fromIndex) &&
        isItemPoint(seg.to, seg.toIndex);
      if (allPositions && waypointIndices && adjacentItems) {
        const startIndex = waypointIndices[seg.fromIndex];
        const segPositions = allPositions.slice(startIndex, waypointIndices[seg.toIndex] + 1);
        if (segPositions.length > 2) {
          // Distribute travel time proportionally by distance
          const cumDists = cumulativeDistances(segPositions);
          const totalDist = cumDists[cumDists.length - 1];
          // Skip first (the leg start) and last (the arrival sample below)
          for (let j = 1; j < segPositions.length - 1; j++) {
            const frac = totalDist > 0 ? cumDists[j] / totalDist : j / (segPositions.length - 1);
            const intermediateT = JulianDate.addSeconds(t, travelTime * frac, _scratch);
            const pos = segPositions[j];
            const agl =
              aglAtPathIndex(pos, startIndex + j) ?? from.agl + (to.agl - from.agl) * frac;
            addPosition(intermediateT, { pos, agl });
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
    addPosition(t, to);
  }

  // The final item's hold, as the flight plan counts it
  const last = segments[segments.length - 1];
  const finalHold = flightPlan.totalDuration - last.cumulativeDuration;
  if (finalHold > 0) {
    t = JulianDate.addSeconds(t, finalHold, _scratch);
    t = JulianDate.clone(t);
    addPosition(t, sampleOf(last.to, last.toIndex));
    sampledHeading.addSample(JulianDate.clone(t), -CesiumMath.toRadians(last.heading));
  }

  return { sampledPosition, sampledHeading, sampledAgl, startJulian };
}
