/**
 * Wind estimation from recorded telemetry frames.
 *
 * The autopilot's own wind estimate (the recorded `wind` channel: MAVLink
 * WIND, or the ULog wind topic) is used whenever it is present. Otherwise the
 * wind is the difference between the ground-track velocity, taken from the
 * position fixes, and the air velocity, taken from VFR_HUD airspeed along the
 * heading. That second method needs a real airspeed sensor: without one the
 * autopilot reports GPS ground speed as airspeed, and the difference is
 * noise. With neither source the flight has no wind estimate.
 *
 * @module wind-estimator
 * @license GPL-3.0-only
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import type { WindEstimate } from "../types";

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const METERS_PER_DEG_LAT = 111_320;

/** Minimum valid samples required for a meaningful estimate. */
const MIN_SAMPLES = 5;

/** MAV_SYS_STATUS_SENSOR_DIFFERENTIAL_PRESSURE: an airspeed sensor. */
const SENSOR_DIFFERENTIAL_PRESSURE = 0x10;

/** Shortest position-fix spacing used to derive a ground-track velocity. */
const TRACK_MIN_DT_MS = 1000;

/** Oldest ground-track velocity an airspeed sample may be paired with. */
const TRACK_MAX_AGE_MS = 2000;

interface Vector {
  e: number;
  n: number;
}

function toEstimate(sumE: number, sumN: number, count: number, method: WindEstimate["method"]): WindEstimate {
  const e = sumE / count;
  const n = sumN / count;
  // Direction the wind blows FROM (meteorological convention).
  const fromDirDeg = (Math.atan2(-e, -n) * RAD_TO_DEG + 360) % 360;
  return {
    speedMs: Math.round(Math.hypot(e, n) * 100) / 100,
    fromDirDeg: Math.round(fromDirDeg) % 360,
    sampleCount: count,
    method,
  };
}

/** Average the autopilot's own wind samples as vectors. */
function averageFcWind(frames: TelemetryFrame[]): WindEstimate | undefined {
  let sumE = 0;
  let sumN = 0;
  let count = 0;
  for (const f of frames) {
    if (f.channel !== "wind") continue;
    const d = f.data as { direction?: number; speed?: number };
    if (typeof d.direction !== "number" || typeof d.speed !== "number" || !Number.isFinite(d.direction)) continue;
    // `direction` is where the wind comes from; the velocity points away.
    const r = d.direction * DEG_TO_RAD;
    sumE -= d.speed * Math.sin(r);
    sumN -= d.speed * Math.cos(r);
    count++;
  }
  return count >= MIN_SAMPLES ? toEstimate(sumE, sumN, count, "fc_estimate") : undefined;
}

function hasAirspeedSensor(frames: TelemetryFrame[]): boolean {
  return frames.some((f) => {
    if (f.channel !== "sysStatus") return false;
    const d = f.data as { sensorsPresent?: number; sensorsHealthy?: number };
    return (
      typeof d.sensorsPresent === "number" &&
      typeof d.sensorsHealthy === "number" &&
      (d.sensorsPresent & SENSOR_DIFFERENTIAL_PRESSURE) !== 0 &&
      (d.sensorsHealthy & SENSOR_DIFFERENTIAL_PRESSURE) !== 0
    );
  });
}

/** Ground minus air velocity, averaged over every airspeed sample with a recent track. */
function estimateFromAirspeed(frames: TelemetryFrame[]): WindEstimate | undefined {
  let trackAnchor: { t: number; lat: number; lon: number } | undefined;
  let ground: (Vector & { t: number }) | undefined;
  let sumE = 0;
  let sumN = 0;
  let count = 0;

  for (const f of frames) {
    const t = f.offsetMs;
    if (f.channel === "position" || f.channel === "globalPosition") {
      const d = f.data as { lat?: number; lon?: number };
      if (typeof d.lat !== "number" || typeof d.lon !== "number") continue;
      if (!trackAnchor) {
        trackAnchor = { t, lat: d.lat, lon: d.lon };
        continue;
      }
      const dt = t - trackAnchor.t;
      if (dt < TRACK_MIN_DT_MS) continue;
      const seconds = dt / 1000;
      const n = ((d.lat - trackAnchor.lat) * METERS_PER_DEG_LAT) / seconds;
      const e = ((d.lon - trackAnchor.lon) * METERS_PER_DEG_LAT * Math.cos(d.lat * DEG_TO_RAD)) / seconds;
      ground = { t, e, n };
      trackAnchor = { t, lat: d.lat, lon: d.lon };
    } else if (f.channel === "vfr") {
      const d = f.data as { airspeed?: number; heading?: number };
      if (!ground || t - ground.t > TRACK_MAX_AGE_MS) continue;
      if (typeof d.airspeed !== "number" || d.airspeed <= 0 || typeof d.heading !== "number") continue;
      const h = d.heading * DEG_TO_RAD;
      sumE += ground.e - d.airspeed * Math.sin(h);
      sumN += ground.n - d.airspeed * Math.cos(h);
      count++;
    }
  }
  return count >= MIN_SAMPLES ? toEstimate(sumE, sumN, count, "vfr_diff") : undefined;
}

/**
 * Estimate the wind for a flight, or `undefined` when neither the
 * autopilot's estimate nor a real airspeed sensor was recorded.
 */
export function estimateWind(frames: TelemetryFrame[]): WindEstimate | undefined {
  return averageFcWind(frames) ?? (hasAirspeedSensor(frames) ? estimateFromAirspeed(frames) : undefined);
}
