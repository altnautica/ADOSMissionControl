/**
 * @module simulation-utils
 * @description Flight plan computation and position interpolation for mission simulation.
 * Computes flight segments from waypoints and interpolates drone position at any elapsed time.
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { haversineDistance, bearing, normalizeHeading } from "@/lib/telemetry-utils";

export interface FlightSegment {
  fromIndex: number;
  toIndex: number;
  distance: number;
  speed: number;
  duration: number;
  cumulativeDuration: number;
  heading: number;
}

export interface FlightPlan {
  segments: FlightSegment[];
  totalDuration: number;
  totalDistance: number;
}

export interface InterpolatedPosition {
  lat: number;
  lon: number;
  alt: number;
  heading: number;
  speed: number;
  currentWaypointIndex: number;
  progress: number;
}

/** Stable identity for the mission inputs that affect simulation playback. */
export function createSimulationMissionSignature(
  waypoints: Waypoint[],
  defaultSpeed: number
): string {
  return JSON.stringify({
    defaultSpeed,
    waypoints: waypoints.map((wp) => [
      wp.id,
      wp.lat,
      wp.lon,
      wp.alt,
      wp.speed ?? null,
      wp.holdTime ?? null,
      wp.command ?? null,
      wp.param1 ?? null,
      wp.param2 ?? null,
      wp.param3 ?? null,
    ]),
  });
}

/** Compute 3D distance between two waypoints (haversine + altitude delta). */
function distance3D(wp1: Waypoint, wp2: Waypoint): number {
  const hDist = haversineDistance(wp1.lat, wp1.lon, wp2.lat, wp2.lon);
  const dAlt = wp2.alt - wp1.alt;
  return Math.sqrt(hDist * hDist + dAlt * dAlt);
}

/** Compute flight plan from waypoints. */
export function computeFlightPlan(waypoints: Waypoint[], defaultSpeed: number): FlightPlan {
  if (waypoints.length < 2) {
    return { segments: [], totalDuration: 0, totalDistance: 0 };
  }

  const segments: FlightSegment[] = [];
  let cumDuration = 0;
  let totalDistance = 0;

  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const dist = distance3D(from, to);
    // The uploaded speed of a leg: the destination's own speed, else the
    // mission default (see the speed note in mission/mission-expand).
    const speed = to.speed ?? defaultSpeed;
    // Only these commands hold for `holdTime` seconds. An unlimited LOITER
    // never advances on its own, and LOITER_TURNS / PAYLOAD_PLACE keep turns
    // and a descent distance in that slot.
    const holds = from.command === undefined || from.command === "WAYPOINT"
      || from.command === "SPLINE_WAYPOINT" || from.command === "LOITER_TIME";
    const holdTime = holds ? from.holdTime ?? 0 : 0;
    const duration = holdTime + (speed > 0 ? dist / speed : 0);
    const hdg = bearing(from.lat, from.lon, to.lat, to.lon);

    cumDuration += duration;
    totalDistance += dist;

    segments.push({
      fromIndex: i,
      toIndex: i + 1,
      distance: dist,
      speed,
      duration,
      cumulativeDuration: cumDuration,
      heading: hdg,
    });
  }

  // Add final waypoint hold time if present
  const lastWp = waypoints[waypoints.length - 1];
  const finalHold = lastWp.holdTime ?? 0;
  const totalDuration = cumDuration + finalHold;

  return { segments, totalDuration, totalDistance };
}

/** Interpolate drone position at a given elapsed time. */
export function interpolatePosition(
  segments: FlightSegment[],
  waypoints: Waypoint[],
  elapsedTime: number
): InterpolatedPosition {
  if (waypoints.length === 0) {
    return { lat: 0, lon: 0, alt: 0, heading: 0, speed: 0, currentWaypointIndex: 0, progress: 0 };
  }

  if (segments.length === 0 || elapsedTime <= 0) {
    const wp = waypoints[0];
    return {
      lat: wp.lat,
      lon: wp.lon,
      alt: wp.alt,
      heading: segments.length > 0 ? segments[0].heading : 0,
      speed: 0,
      currentWaypointIndex: 0,
      progress: 0,
    };
  }

  const segmentsDuration = segments[segments.length - 1].cumulativeDuration;
  const finalHold = waypoints[waypoints.length - 1].holdTime ?? 0;
  const totalDuration = segmentsDuration + finalHold;

  if (elapsedTime >= segmentsDuration) {
    // Past all segments — holding at final waypoint or done
    const wp = waypoints[waypoints.length - 1];
    return {
      lat: wp.lat,
      lon: wp.lon,
      alt: wp.alt,
      heading: segments[segments.length - 1].heading,
      speed: 0,
      currentWaypointIndex: waypoints.length - 1,
      progress: totalDuration > 0 ? Math.min(elapsedTime / totalDuration, 1) : 1,
    };
  }

  // Find the active segment
  let segIdx = 0;
  for (let i = 0; i < segments.length; i++) {
    if (elapsedTime <= segments[i].cumulativeDuration) {
      segIdx = i;
      break;
    }
  }

  const seg = segments[segIdx];
  const segStart = segIdx > 0 ? segments[segIdx - 1].cumulativeDuration : 0;
  const from = waypoints[seg.fromIndex];
  const holdTime = from.holdTime ?? 0;
  const timeInSeg = elapsedTime - segStart;

  // Still holding at the from waypoint
  if (timeInSeg <= holdTime) {
    return {
      lat: from.lat,
      lon: from.lon,
      alt: from.alt,
      heading: seg.heading,
      speed: 0,
      currentWaypointIndex: seg.fromIndex,
      progress: elapsedTime / totalDuration,
    };
  }

  // Traveling between waypoints
  const travelTime = timeInSeg - holdTime;
  const travelDuration = seg.duration - holdTime;
  const t = travelDuration > 0 ? Math.min(travelTime / travelDuration, 1) : 1;

  const to = waypoints[seg.toIndex];
  const lat = from.lat + (to.lat - from.lat) * t;
  const lon = from.lon + (to.lon - from.lon) * t;
  const alt = from.alt + (to.alt - from.alt) * t;

  return {
    lat,
    lon,
    alt,
    heading: seg.heading,
    speed: seg.speed,
    currentWaypointIndex: t > 0.5 ? seg.toIndex : seg.fromIndex,
    progress: elapsedTime / totalDuration,
  };
}

/** Get altitude-based color for path visualization. */
export function altitudeColor(alt: number, minAlt: number, maxAlt: number): string {
  if (maxAlt <= minAlt) return "#3a82ff";
  const t = (alt - minAlt) / (maxAlt - minAlt);
  if (t < 0.5) {
    // Blue to green
    const s = t * 2;
    const r = Math.round(0x3a * (1 - s) + 0x22 * s);
    const g = Math.round(0x82 * (1 - s) + 0xc5 * s);
    const b = Math.round(0xff * (1 - s) + 0x5e * s);
    return `rgb(${r},${g},${b})`;
  }
  // Green to lime
  const s = (t - 0.5) * 2;
  const r = Math.round(0x22 * (1 - s) + 0xdf * s);
  const g = Math.round(0xc5 * (1 - s) + 0xf1 * s);
  const b = Math.round(0x5e * (1 - s) + 0x40 * s);
  return `rgb(${r},${g},${b})`;
}

/** Format seconds as M:SS. */
export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
