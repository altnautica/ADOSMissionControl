/**
 * @module simulation-utils
 * @description Flight plan computation and position interpolation for mission simulation.
 * Computes flight segments from waypoints and interpolates drone position at any elapsed time.
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint } from "@/lib/types";
import { haversineDistance, bearing, normalizeHeading } from "@/lib/telemetry-utils";
import { isActionCommand } from "@/lib/mission/command-classes";

/** A resolved point the simulated vehicle flies to. */
export interface SimPoint {
  lat: number;
  lon: number;
  alt: number;
}

export interface FlightSegment {
  /** Planner index of the item this leg starts at. */
  fromIndex: number;
  /** Planner index of the item this leg flies to. */
  toIndex: number;
  /** Where the leg starts and ends. An RTL leg ends at home, not at the RTL
   * item's own (placeholder) coordinates. */
  from: SimPoint;
  to: SimPoint;
  /** Seconds held at `from` before the leg is flown. */
  holdTime: number;
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
  defaultSpeed: number,
  defaultFrame: AltitudeFrame,
): string {
  return JSON.stringify({
    defaultSpeed,
    defaultFrame,
    waypoints: waypoints.map((wp) => [
      wp.id,
      wp.lat,
      wp.lon,
      wp.alt,
      wp.frame ?? null,
      wp.speed ?? null,
      wp.holdTime ?? null,
      wp.command ?? null,
      wp.param1 ?? null,
      wp.param2 ?? null,
      wp.param3 ?? null,
    ]),
  });
}

/** Compute 3D distance between two points (haversine + altitude delta). */
function distance3D(a: SimPoint, b: SimPoint): number {
  const hDist = haversineDistance(a.lat, a.lon, b.lat, b.lon);
  const dAlt = b.alt - a.alt;
  return Math.sqrt(hDist * hDist + dAlt * dAlt);
}

/**
 * The navigation commands that wait `holdTime` seconds at the waypoint. An
 * unlimited LOITER never advances on its own, and LOITER_TURNS / PAYLOAD_PLACE
 * keep turns and a descent distance in that slot.
 */
const HOLDING_COMMANDS: Record<string, true> = { WAYPOINT: true, SPLINE_WAYPOINT: true, LOITER_TIME: true };

/** Altitude RTL climbs to before returning: the ArduPilot RTL_ALT default (15 m). */
export const SIM_RTL_ALT_M = 15;

function holdAt(wp: Waypoint): number {
  return HOLDING_COMMANDS[wp.command ?? "WAYPOINT"] ? wp.holdTime ?? 0 : 0;
}

/**
 * The points a nav item is flown through from `prev`. RTL climbs to the RTL
 * altitude, returns to `home` at that altitude and descends there; its own
 * coordinates are a placeholder (the planner puts the last waypoint's, a
 * downloaded mission 0/0). Any other nav item at 0/0 carries no position and
 * acts where the vehicle already is.
 */
function legPoints(wp: Waypoint, prev: SimPoint, home: SimPoint, rtlAlt: number): SimPoint[] {
  if (wp.command === "RTL") {
    const cruise = Math.max(prev.alt, rtlAlt);
    const points: SimPoint[] = [];
    if (cruise > prev.alt) points.push({ lat: prev.lat, lon: prev.lon, alt: cruise });
    points.push({ lat: home.lat, lon: home.lon, alt: cruise });
    points.push({ lat: home.lat, lon: home.lon, alt: home.alt });
    return points;
  }
  if (wp.lat === 0 && wp.lon === 0) return [{ lat: prev.lat, lon: prev.lon, alt: wp.alt }];
  return [{ lat: wp.lat, lon: wp.lon, alt: wp.alt }];
}

export interface FlightPlanOptions {
  /** Where RTL returns to. Defaults to the first flown item's position at 0 m,
   * the same launch point the mission upload falls back to. */
  home?: { lat: number; lon: number };
  /** Altitude RTL climbs to before returning. */
  rtlAltM?: number;
}

/**
 * Compute the flight plan from the mission items. Action items carry no leg
 * of their own (they act at the preceding nav item), so they are skipped; RTL
 * is flown back to home.
 */
export function computeFlightPlan(
  waypoints: Waypoint[],
  defaultSpeed: number,
  options: FlightPlanOptions = {},
): FlightPlan {
  const flown: number[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    if (!isActionCommand(waypoints[i].command)) flown.push(i);
  }
  if (flown.length < 2) {
    return { segments: [], totalDuration: 0, totalDistance: 0 };
  }

  const first = waypoints[flown[0]];
  const homeLatLon = options.home ?? { lat: first.lat, lon: first.lon };
  const home: SimPoint = { ...homeLatLon, alt: 0 };
  const rtlAlt = options.rtlAltM ?? SIM_RTL_ALT_M;

  const segments: FlightSegment[] = [];
  let cumDuration = 0;
  let totalDistance = 0;
  let prev: SimPoint = { lat: first.lat, lon: first.lon, alt: first.alt };

  for (let k = 1; k < flown.length; k++) {
    const fromIndex = flown[k - 1];
    const toIndex = flown[k];
    const to = waypoints[toIndex];
    // The uploaded speed of a leg: the destination's own speed, else the
    // mission default (see the speed note in mission/mission-expand).
    const speed = to.speed ?? defaultSpeed;
    let hold = holdAt(waypoints[fromIndex]);
    for (const point of legPoints(to, prev, home, rtlAlt)) {
      const dist = distance3D(prev, point);
      const duration = hold + (speed > 0 ? dist / speed : 0);
      cumDuration += duration;
      totalDistance += dist;
      segments.push({
        fromIndex,
        toIndex,
        from: prev,
        to: point,
        holdTime: hold,
        distance: dist,
        speed,
        duration,
        cumulativeDuration: cumDuration,
        heading:
          point.lat === prev.lat && point.lon === prev.lon
            ? (segments[segments.length - 1]?.heading ?? 0)
            : bearing(prev.lat, prev.lon, point.lat, point.lon),
      });
      prev = point;
      hold = 0;
    }
  }

  // Add the final item's hold, when its command holds at all
  const totalDuration = cumDuration + holdAt(waypoints[flown[flown.length - 1]]);

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
    const start = segments[0]?.from ?? waypoints[0];
    return {
      lat: start.lat,
      lon: start.lon,
      alt: start.alt,
      heading: segments.length > 0 ? segments[0].heading : 0,
      speed: 0,
      currentWaypointIndex: segments[0]?.fromIndex ?? 0,
      progress: 0,
    };
  }

  const last = segments[segments.length - 1];
  const segmentsDuration = last.cumulativeDuration;
  const finalHold = holdAt(waypoints[last.toIndex]);
  const totalDuration = segmentsDuration + finalHold;

  if (elapsedTime >= segmentsDuration) {
    // Past all segments — holding at the final point or done
    return {
      lat: last.to.lat,
      lon: last.to.lon,
      alt: last.to.alt,
      heading: last.heading,
      speed: 0,
      currentWaypointIndex: last.toIndex,
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
  const { from, to, holdTime } = seg;
  const timeInSeg = elapsedTime - segStart;

  // Still holding at the from point
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

  // Traveling between points
  const travelTime = timeInSeg - holdTime;
  const travelDuration = seg.duration - holdTime;
  const t = travelDuration > 0 ? Math.min(travelTime / travelDuration, 1) : 1;

  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lon: from.lon + (to.lon - from.lon) * t,
    alt: from.alt + (to.alt - from.alt) * t,
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
