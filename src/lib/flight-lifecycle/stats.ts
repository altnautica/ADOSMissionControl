/**
 * Flight-stat derivation. Pure — walks recorded telemetry frames once and
 * produces an aggregate `FlightStats` (distance, max altitude / speed,
 * battery delta, downsampled path). No I/O.
 *
 * @module flight-lifecycle/stats
 */

import type { TelemetryFrame } from "../telemetry-recorder";
import { haversineDistance } from "@/lib/geo/distance";
import { knownRemainingPct } from "@/lib/battery";

export interface FlightStats {
  distance: number;
  maxAlt: number;
  maxSpeed: number;
  avgSpeed: number;
  batteryStartV?: number;
  batteryEndV?: number;
  /** Percent of the pack used; undefined when no remaining-% was reported. */
  batteryUsed?: number;
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
      // 0,0 is the autopilot's "no position estimate yet", not a fix.
      if (typeof d.lat === "number" && typeof d.lon === "number" && !(d.lat === 0 && d.lon === 0)) {
        if (prevLat !== undefined && prevLon !== undefined) {
          distance += haversineDistance(prevLat, prevLon, d.lat, d.lon);
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
      const remaining = knownRemainingPct(d.remaining);
      if (remaining !== null) {
        if (batteryStartPct === undefined) batteryStartPct = remaining;
        batteryEndPct = remaining;
      }
    }
  }

  const batteryUsed =
    batteryStartPct !== undefined && batteryEndPct !== undefined
      ? Math.max(0, Math.round(batteryStartPct - batteryEndPct))
      : undefined;

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
