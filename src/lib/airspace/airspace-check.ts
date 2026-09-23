/**
 * @module airspace/airspace-check
 * @description Keyless static-ring airspace proximity gate. Flags mission
 * waypoints, and the legs flown between them, that come within warning /
 * error distance rings of a major airport, using the offline
 * {@link MAJOR_AIRPORTS} dataset (no OpenAIP, no network).
 * Pure logic — no store or React imports.
 * @license GPL-3.0-only
 */

import { MAJOR_AIRPORTS, type Airport } from "./airports";

/** Mean Earth radius (km) for the local projection around each airport. */
const EARTH_RADIUS_KM = 6371.0088;
const DEG_TO_RAD = Math.PI / 180;

/** A point with a latitude and longitude. Any waypoint-like shape works. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** Severity of an airport-proximity issue. */
export type AirspaceIssueLevel = "warn" | "error";

/** A single airport-proximity finding. */
export interface AirspaceProximityIssue {
  /** `"error"` inside the inner ring, `"warn"` inside the outer ring. */
  level: AirspaceIssueLevel;
  /** The nearest airport that triggered the issue. */
  airport: Airport;
  /** Closest-approach distance across the mission's route (kilometers). */
  distanceKm: number;
  /** Waypoint at the closest approach; with `onLeg`, the start of that leg. */
  waypointIndex: number;
  /** True when the closest approach lies between `waypointIndex` and the next
   * waypoint rather than at a waypoint. */
  onLeg: boolean;
  /** Human-readable summary. */
  message: string;
}

/** Thresholds for the static rings. Defaults: warn at 8 km, error at 5 km. */
export interface AirspaceCheckOptions {
  /** Outer warning ring radius in kilometers. Default 8. */
  warnKm?: number;
  /** Inner error ring radius in kilometers. Default 5. */
  errorKm?: number;
}

/**
 * Check the mission route against the static airport rings.
 *
 * Each waypoint and each straight leg between consecutive waypoints is
 * measured against every airport; a leg that overflies a field is caught even
 * when both of its waypoints sit outside the rings. For each airport the route
 * approaches within `warnKm`, a single issue is emitted at the closest
 * approach (deduplicated per airport so a mission that lingers near one field
 * does not flood the panel). Inside `errorKm` the issue is `"error"`; between
 * `errorKm` and `warnKm` it is `"warn"`.
 *
 * Distances are measured in a local east/north plane centred on each airport,
 * which is accurate well beyond the ring radii.
 *
 * @param waypoints ordered mission waypoints (lat/lon)
 * @param options ring radii; `errorKm` should be <= `warnKm`
 * @returns issues sorted by ascending closest-approach distance
 */
export function checkAirportProximity(
  waypoints: readonly LatLon[],
  options: AirspaceCheckOptions = {}
): AirspaceProximityIssue[] {
  const warnKm = options.warnKm ?? 8;
  const errorKmRaw = options.errorKm ?? 5;
  // Guard against a misconfigured errorKm > warnKm: the error ring can never be
  // larger than the warning ring.
  const errorKm = Math.min(errorKmRaw, warnKm);

  const route: { lat: number; lon: number; index: number }[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (Number.isFinite(wp.lat) && Number.isFinite(wp.lon)) {
      route.push({ lat: wp.lat, lon: wp.lon, index: i });
    }
  }
  if (route.length === 0) return [];

  const issues: AirspaceProximityIssue[] = [];
  for (const airport of MAJOR_AIRPORTS) {
    const approach = closestApproach(route, airport);
    if (approach.distanceKm > warnKm) continue;

    const level: AirspaceIssueLevel = approach.distanceKm <= errorKm ? "error" : "warn";
    const ring = level === "error" ? errorKm : warnKm;
    const where = approach.onLeg
      ? `Leg WP${approach.waypointIndex + 1}→WP${approach.nextIndex + 1} passes`
      : `WP${approach.waypointIndex + 1} is`;
    const message =
      `${where} ${approach.distanceKm.toFixed(1)} km from ${airport.name} ` +
      `(${airport.icao}), inside the ${ring} km ` +
      `${level === "error" ? "no-fly" : "caution"} ring.`;
    issues.push({
      level,
      airport,
      distanceKm: approach.distanceKm,
      waypointIndex: approach.waypointIndex,
      onLeg: approach.onLeg,
      message,
    });
  }

  issues.sort((a, b) => a.distanceKm - b.distanceKm);
  return issues;
}

interface Approach {
  distanceKm: number;
  waypointIndex: number;
  nextIndex: number;
  onLeg: boolean;
}

/** Closest approach of the route (vertices and legs) to one airport. */
function closestApproach(
  route: readonly { lat: number; lon: number; index: number }[],
  airport: Airport,
): Approach {
  const cosLat = Math.cos(airport.lat * DEG_TO_RAD);
  // East/north offset (km) of a route point from the airport.
  const local = (p: { lat: number; lon: number }): [number, number] => {
    let dLon = p.lon - airport.lon;
    if (dLon > 180) dLon -= 360;
    else if (dLon < -180) dLon += 360;
    return [
      dLon * DEG_TO_RAD * EARTH_RADIUS_KM * cosLat,
      (p.lat - airport.lat) * DEG_TO_RAD * EARTH_RADIUS_KM,
    ];
  };

  const [x0, y0] = local(route[0]);
  let best: Approach = {
    distanceKm: Math.hypot(x0, y0),
    waypointIndex: route[0].index,
    nextIndex: route[0].index,
    onLeg: false,
  };
  let [ax, ay] = [x0, y0];
  for (let i = 1; i < route.length; i++) {
    const [bx, by] = local(route[i]);
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    // Parameter of the airport's projection onto the leg, clamped to the leg.
    const t = lenSq > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / lenSq)) : 0;
    const distanceKm = Math.hypot(ax + t * dx, ay + t * dy);
    if (distanceKm < best.distanceKm) {
      const atStart = t === 0;
      const atEnd = t === 1;
      best = {
        distanceKm,
        waypointIndex: atEnd ? route[i].index : route[i - 1].index,
        nextIndex: route[i].index,
        onLeg: !atStart && !atEnd,
      };
    }
    [ax, ay] = [bx, by];
  }
  return best;
}
