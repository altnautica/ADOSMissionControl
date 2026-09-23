/**
 * @module altitude-profile
 * @description Pure charting math shared by the altitude-profile views.
 * Provides cumulative ground distance per waypoint, a padded altitude range,
 * and a linear value-to-pixel scale factory. Rendering (recharts area chart vs
 * raw SVG polyline) stays with each view; only the geometry math is shared here.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { haversineDistance } from "@/lib/geo/distance";

/** Inclusive numeric range for an axis. */
export interface AltitudeRange {
  minAlt: number;
  maxAlt: number;
}

/**
 * Cumulative ground distance (metres) at each waypoint, walking the path in
 * order. The first entry is always 0; each subsequent entry adds the great
 * circle distance from the previous waypoint.
 */
export function cumulativeGroundDistances(waypoints: Waypoint[]): number[] {
  let cum = 0;
  return waypoints.map((wp, i) => {
    if (i > 0) {
      cum += haversineDistance(waypoints[i - 1].lat, waypoints[i - 1].lon, wp.lat, wp.lon);
    }
    return cum;
  });
}

/**
 * Padded altitude range across the given altitudes, floored at 0.
 * Padding is 15% of the span, with a 5 metre minimum so a flat profile still
 * renders with vertical room. Returns a default 0..100 range when empty.
 */
export function altitudeRange(altitudes: number[]): AltitudeRange {
  if (altitudes.length === 0) return { minAlt: 0, maxAlt: 100 };
  const min = Math.min(...altitudes);
  const max = Math.max(...altitudes);
  const pad = Math.max((max - min) * 0.15, 5);
  return { minAlt: Math.max(0, min - pad), maxAlt: max + pad };
}

/**
 * Build a linear scale mapping a value in [domainMin, domainMax] onto pixels in
 * [rangeStart, rangeStart + rangeLength]. When `invert` is true the range is
 * flipped (used for the Y axis, where a higher value maps to a smaller pixel y).
 * A zero-width domain maps everything to the start of the range.
 */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeStart: number,
  rangeLength: number,
  invert = false,
): (value: number) => number {
  const span = domainMax - domainMin;
  return (value: number) => {
    const t = span === 0 ? 0 : (value - domainMin) / span;
    const frac = invert ? 1 - t : t;
    return rangeStart + frac * rangeLength;
  };
}
