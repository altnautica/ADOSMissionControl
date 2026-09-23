/**
 * Flight-stat derivation. Pure — walks recorded telemetry frames once and
 * produces an aggregate `FlightStats` (distance, max altitude / speed,
 * battery delta, downsampled path). No I/O.
 *
 * @module flight-lifecycle/stats
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import { haversineMeters } from "./geo";

export interface FlightStats {
  distance: number;
  maxAlt: number;
  maxSpeed: number;
  avgSpeed: number;
  batteryStartV?: number;
  batteryEndV?: number;
  batteryUsed: number;
  path: [number, number][];
  landingLat?: number;
  landingLon?: number;
}

interface PositionFrameData { lat: number; lon: number; relativeAlt?: number; groundSpeed?: number }
interface BatteryFrameData { voltage: number; remaining: number }
interface VfrFrameData { groundspeed: number }

/**
 * Walk recorded frames once and derive flight stats.
 *
 * `maxAlt` is height above home, taken only from the position frames'
 * `relativeAlt`. VFR_HUD `alt` and GLOBAL_POSITION_INT `alt` are AMSL on
 * ArduPilot and would report the field elevation as flight altitude.
 *
 * Pure function — no I/O.
 */
export function computeFlightStats(frames: TelemetryFrame[]): FlightStats {
  let distance = 0;
  let maxAlt = 0;
  let maxSpeed = 0;
  let speedSum = 0;
  let speedCount = 0;
  let batteryStartV: number | undefined;
  let batteryEndV: number | undefined;
  let batteryStartPct: number | undefined;
  let batteryEndPct: number | undefined;
  let landingLat: number | undefined;
  let landingLon: number | undefined;
  let prevLat: number | undefined;
  let prevLon: number | undefined;

  // Path downsample: 1 sample per ~1 s, max 1000 points.
  const path: [number, number][] = [];
  let lastPathTimeMs = -Infinity;
  const PATH_INTERVAL_MS = 1000;
  const PATH_MAX = 1000;

  for (const frame of frames) {
    if (frame.channel === "position" || frame.channel === "globalPosition") {
      const d = frame.data as PositionFrameData;
      if (typeof d.lat === "number" && typeof d.lon === "number") {
        if (prevLat !== undefined && prevLon !== undefined) {
          distance += haversineMeters(prevLat, prevLon, d.lat, d.lon);
        }
        prevLat = d.lat;
        prevLon = d.lon;
        landingLat = d.lat;
        landingLon = d.lon;

        if (typeof d.relativeAlt === "number" && d.relativeAlt > maxAlt) maxAlt = d.relativeAlt;

        if (typeof d.groundSpeed === "number" && d.groundSpeed > 0) {
          if (d.groundSpeed > maxSpeed) maxSpeed = d.groundSpeed;
          speedSum += d.groundSpeed;
          speedCount += 1;
        }

        if (frame.offsetMs - lastPathTimeMs >= PATH_INTERVAL_MS && path.length < PATH_MAX) {
          path.push([d.lat, d.lon]);
          lastPathTimeMs = frame.offsetMs;
        }
      }
    } else if (frame.channel === "vfr") {
      const d = frame.data as VfrFrameData;
      if (typeof d.groundspeed === "number" && d.groundspeed > 0) {
        if (d.groundspeed > maxSpeed) maxSpeed = d.groundspeed;
        speedSum += d.groundspeed;
        speedCount += 1;
      }
    } else if (frame.channel === "battery") {
      const d = frame.data as BatteryFrameData;
      if (typeof d.voltage === "number") {
        if (batteryStartV === undefined) batteryStartV = d.voltage;
        batteryEndV = d.voltage;
      }
      // -1 is the autopilot's "remaining not measured".
      if (typeof d.remaining === "number" && d.remaining >= 0) {
        if (batteryStartPct === undefined) batteryStartPct = d.remaining;
        batteryEndPct = d.remaining;
      }
    }
  }

  let batteryUsed = 0;
  if (batteryStartPct !== undefined && batteryEndPct !== undefined) {
    batteryUsed = Math.max(0, Math.round(batteryStartPct - batteryEndPct));
  } else if (batteryEndPct !== undefined) {
    batteryUsed = Math.max(0, Math.round(100 - batteryEndPct));
  }

  return {
    distance: Math.round(distance),
    maxAlt: Math.round(maxAlt),
    maxSpeed: Math.round(maxSpeed * 10) / 10,
    avgSpeed: speedCount > 0 ? Math.round((speedSum / speedCount) * 10) / 10 : 0,
    batteryStartV,
    batteryEndV,
    batteryUsed,
    path,
    landingLat,
    landingLon,
  };
}
