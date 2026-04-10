/**
 * Wind estimation from VFR telemetry frames.
 *
 * Uses the groundspeed-vs-airspeed difference method: when the FC reports
 * both `groundspeed` and `airspeed` in VFR_HUD, the wind vector is the
 * difference between the ground-track velocity and the heading-projected
 * airspeed. Most multirotors lack airspeed sensors, so for those flights
 * this returns `undefined`.
 *
 * @module wind-estimator
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import type { WindEstimate } from "../types";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** Minimum valid samples required for a meaningful estimate. */
const MIN_SAMPLES = 5;

/**
 * Estimate wind from VFR_HUD frames that carry both `groundspeed` and
 * `airspeed`. Returns `undefined` when insufficient data is available
 * (e.g. no airspeed sensor on most copters).
 */
export function estimateWind(
  frames: TelemetryFrame[],
): WindEstimate | undefined {
  const vfrFrames = frames.filter((f) => f.channel === "vfr");

  let sumWx = 0;
  let sumWy = 0;
  let count = 0;

  for (const f of vfrFrames) {
    const gs = (f.data as Record<string, number>).groundspeed;
    const as = (f.data as Record<string, number>).airspeed;
    const hdg = (f.data as Record<string, number>).heading; // degrees 0-360

    // Skip frames without a valid airspeed reading
    if (
      as === undefined ||
      as <= 0 ||
      gs === undefined ||
      gs < 0 ||
      hdg === undefined
    ) {
      continue;
    }

    const hRad = hdg * DEG_TO_RAD;

    // Ground velocity components (East, North)
    const gE = gs * Math.sin(hRad);
    const gN = gs * Math.cos(hRad);

    // Airspeed projected onto heading (body axis approximation)
    const aE = as * Math.sin(hRad);
    const aN = as * Math.cos(hRad);

    // Wind = ground - air
    sumWx += gE - aE;
    sumWy += gN - aN;
    count++;
  }

  if (count < MIN_SAMPLES) return undefined;

  const avgWx = sumWx / count;
  const avgWy = sumWy / count;

  const speedMs = Math.sqrt(avgWx * avgWx + avgWy * avgWy);

  // Direction wind is blowing FROM (meteorological convention)
  const fromDirDeg =
    ((Math.atan2(-avgWx, -avgWy) * RAD_TO_DEG) + 360) % 360;

  return {
    speedMs: Math.round(speedMs * 100) / 100,
    fromDirDeg: Math.round(fromDirDeg),
    sampleCount: count,
    method: "vfr_diff",
  };
}
