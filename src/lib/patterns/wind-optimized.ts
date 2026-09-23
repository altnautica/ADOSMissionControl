/**
 * @module patterns/wind-optimized
 * @description Wind-optimized survey line orientation.
 *
 * A survey (lawnmower) pattern is flown as a set of long parallel legs joined by
 * short end turns. Wind interacts with the long legs, so the orientation of those
 * legs relative to the wind decides how stable the imaging passes are.
 *
 * Two orientations are possible, and they trade off differently:
 *
 *  - **Legs ALIGNED WITH the wind (parallel).** Each long imaging leg is flown as a
 *    pure headwind on one pass and a pure tailwind on the return pass. There is no
 *    crosswind component along the leg, so the aircraft holds the line without
 *    crabbing (no side-slip). That keeps the camera geometry stable: the footprint
 *    is not skewed by a crab angle and forward/side overlap stay predictable.
 *    Groundspeed varies (slow into wind, fast downwind), but the headwind and
 *    tailwind legs cancel over a round trip so total energy is balanced. The only
 *    crosswind-sensitive phase is the brief end turn, not the imaging pass.
 *
 *  - **Legs PERPENDICULAR to the wind (crosswind).** Every long leg is flown
 *    crosswind, so the aircraft must crab the entire imaging pass to hold the line.
 *    That constant side-slip skews the image footprint and makes overlap/sidelap
 *    harder to keep, spreading the crosswind cost across every pass. The upside is
 *    that the end turns happen into/out of wind, which some fixed-wing planners
 *    prefer for turn radius.
 *
 * We pick **align-with-wind**: the long imaging legs matter far more than the short
 * end turns, so we keep the imaging passes crab-free and push the crosswind-sensitive
 * crabbing into the end turns. {@link optimalLineBearing} returns that orientation and
 * {@link windPenalty} scores any orientation by the crosswind it forces onto the legs.
 * Both work in compass line bearings; {@link gridAngleLineBearing} converts to and
 * from the survey generator's grid angle.
 *
 * @license GPL-3.0-only
 */

const DEG_TO_RAD = Math.PI / 180;

/**
 * Fold a bearing in degrees into the survey-line axis range [0, 180).
 *
 * A survey line is an axis: the drone flies back and forth along it, so a leg at
 * bearing B and a leg at B+180 are the same line. Normalizing to [0, 180) gives one
 * canonical value per orientation (0 = north-south lines, 90 = east-west lines, as
 * compass bearings).
 *
 * @param deg Any bearing in degrees (may be negative or exceed 360).
 * @returns Equivalent line axis in [0, 180).
 */
export function normalizeLineAxis(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 180;
  if (d < 0) d += 180;
  // Guard against the boundary landing on 180 due to float error.
  if (d >= 180) d -= 180;
  return d === 0 ? 0 : d;
}

/**
 * Acute angular separation in degrees between two line axes, folded into [0, 90].
 *
 * Because survey lines are axes (period 180 degrees), two orientations that differ
 * by 180 are identical and orientations differing by more than 90 are measured from
 * the other side. 0 means the axes are parallel, 90 means perpendicular.
 *
 * @param aDeg First bearing in degrees.
 * @param bDeg Second bearing in degrees.
 * @returns Acute axis separation in [0, 90] degrees.
 */
export function axisAngularDifference(aDeg: number, bDeg: number): number {
  if (!Number.isFinite(aDeg) || !Number.isFinite(bDeg)) return 0;
  let d = Math.abs(aDeg - bDeg) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/**
 * Convert between the survey generator's grid angle and a compass line bearing.
 *
 * The generator rotates the area by the grid angle and lays transects along the
 * east axis, so grid angle 0 flies east-west lines (bearing 90) and 90 flies
 * north-south lines (bearing 0): line bearing = 90 - grid angle. The map is its own
 * inverse, so the same call turns a line bearing back into a grid angle.
 *
 * @param angleDeg A grid angle, or a line bearing, in degrees.
 * @returns The other convention's value, folded into [0, 180).
 */
export function gridAngleLineBearing(angleDeg: number): number {
  return normalizeLineAxis(90 - angleDeg);
}

/**
 * The survey line orientation that flies the long legs into and along the wind.
 *
 * The optimal line axis is simply the wind axis: fly the legs parallel to the wind so
 * each imaging pass is a pure headwind or tailwind and stays crab-free (see the module
 * docstring for the parallel-vs-perpendicular tradeoff). The returned value is a
 * compass line bearing in [0, 180); pass it through {@link gridAngleLineBearing} to
 * get the survey grid angle.
 *
 * Wind bearing convention does not matter here: a survey line is an axis, so a wind
 * "from" 30 degrees and a wind "to" 30 degrees (i.e. from 210) yield the same 30-degree
 * line orientation.
 *
 * @param windBearingDeg Wind bearing in degrees (from- or to-direction; either works).
 * @returns Optimal survey line bearing in [0, 180) degrees.
 */
export function optimalLineBearing(windBearingDeg: number): number {
  return normalizeLineAxis(windBearingDeg);
}

/**
 * Relative-effort penalty for flying survey legs at a given orientation in a given wind.
 *
 * The penalty is the crosswind component the legs must crab against, in meters per
 * second: `windMps * sin(delta)`, where `delta` is the acute axis separation between the
 * line and the wind. A pure head/tailwind (delta = 0) costs nothing here because it does
 * not force a crab and cancels over a round trip; a full crosswind (delta = 90) costs the
 * whole wind speed. So the penalty is 0 at {@link optimalLineBearing} and rises to
 * `windMps` when the legs run perpendicular to the wind.
 *
 * Returned in m/s so it can be compared against the cruise speed to judge whether the
 * crab angle is tolerable; it is a monotonic score, lower is better.
 *
 * @param lineBearingDeg Survey line orientation in degrees (axis; any range).
 * @param windBearingDeg Wind bearing in degrees (axis; any range).
 * @param windMps        Wind speed in meters per second (negative treated as 0).
 * @returns Crosswind component the legs suffer, in m/s (>= 0).
 */
export function windPenalty(
  lineBearingDeg: number,
  windBearingDeg: number,
  windMps: number,
): number {
  if (!Number.isFinite(windMps) || windMps <= 0) return 0;
  const delta = axisAngularDifference(lineBearingDeg, windBearingDeg);
  return windMps * Math.sin(delta * DEG_TO_RAD);
}
