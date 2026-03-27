/**
 * Catmull-Rom spline interpolation for map path preview.
 *
 * Generates smooth curve points between waypoints when
 * SPLINE_WAYPOINT command is used. Pure function, no side effects.
 *
 * @module spline-interpolation
 * @license GPL-3.0-only
 */

/**
 * Generate interpolated points along a Catmull-Rom spline through 4 control points.
 * Returns `segments` intermediate points between p1 and p2 (the middle pair).
 *
 * @param p0 - Previous control point [lat, lon]
 * @param p1 - Start of segment [lat, lon]
 * @param p2 - End of segment [lat, lon]
 * @param p3 - Next control point [lat, lon]
 * @param segments - Number of intermediate points (default 12)
 */
export function catmullRomSegment(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  segments = 12,
): [number, number][] {
  const points: [number, number][] = [];

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const t2 = t * t;
    const t3 = t2 * t;

    // Catmull-Rom basis functions
    const lat =
      0.5 * (
        (2 * p1[0]) +
        (-p0[0] + p2[0]) * t +
        (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
        (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
      );

    const lon =
      0.5 * (
        (2 * p1[1]) +
        (-p0[1] + p2[1]) * t +
        (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
        (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
      );

    points.push([lat, lon]);
  }

  return points;
}

/**
 * Generate a smooth spline path through a sequence of waypoints.
 * Only generates curves for consecutive SPLINE_WAYPOINT segments.
 * Returns the full interpolated path for map rendering.
 *
 * @param waypoints - Array of {lat, lon, command} objects
 * @returns Array of [lat, lon] points for the curved path
 */
export function generateSplinePath(
  waypoints: { lat: number; lon: number; command?: string }[],
): [number, number][] {
  if (waypoints.length < 2) return [];

  const result: [number, number][] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const isSplineSegment =
      waypoints[i].command === "SPLINE_WAYPOINT" ||
      waypoints[i + 1].command === "SPLINE_WAYPOINT";

    if (!isSplineSegment) {
      // Straight segment — just add endpoints
      if (result.length === 0) result.push([waypoints[i].lat, waypoints[i].lon]);
      result.push([waypoints[i + 1].lat, waypoints[i + 1].lon]);
      continue;
    }

    // Spline segment — interpolate with Catmull-Rom
    const p0: [number, number] = i > 0
      ? [waypoints[i - 1].lat, waypoints[i - 1].lon]
      : [waypoints[i].lat, waypoints[i].lon]; // mirror start

    const p1: [number, number] = [waypoints[i].lat, waypoints[i].lon];
    const p2: [number, number] = [waypoints[i + 1].lat, waypoints[i + 1].lon];

    const p3: [number, number] = i + 2 < waypoints.length
      ? [waypoints[i + 2].lat, waypoints[i + 2].lon]
      : [waypoints[i + 1].lat, waypoints[i + 1].lon]; // mirror end

    const curvePoints = catmullRomSegment(p0, p1, p2, p3, 16);

    // Avoid duplicating the start point
    const startIdx = result.length > 0 ? 1 : 0;
    for (let j = startIdx; j < curvePoints.length; j++) {
      result.push(curvePoints[j]);
    }
  }

  return result;
}
