/**
 * @module validation/leg-terrain
 * @description Terrain clearance between waypoints. Both ends of a leg can sit
 * well above the ground while a ridge between them rises into the straight line
 * the vehicle flies, so every leg is checked against a ground profile sampled
 * along it (no more than 30 m apart).
 *
 * A leg whose profile is not available, or whose altitudes cannot be resolved
 * to heights above sea level, is reported unchecked: never as clear.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { isFlownCommand } from "@/lib/mission/command-classes";
import { resolveWaypointAltitude, type AltitudeDatums } from "@/lib/mission/altitude-frame";
import { findCollisionSegments, type ClearanceSample } from "@/lib/terrain/terrain-clearance";
import { haversineDistance } from "@/lib/geo/distance";
import type { ValidationIssue } from "./issue-types";

/** Ground AMSL along each leg, keyed `${fromId}>${toId}`, from-waypoint to to-waypoint inclusive. */
export type LegGroundProfiles = ReadonlyMap<string, readonly number[]>;

const TERMINAL: Record<string, true> = { LAND: true, VTOL_LAND: true, RTL: true };
const LANDING: Record<string, true> = { LAND: true, VTOL_LAND: true };

/**
 * True for a waypoint the vehicle flies to at its own coordinates: a flown
 * navigation command that is not RTL (which flies to home or a rally point)
 * and not an item positioned at run time (0,0 means "where the vehicle is").
 */
export function isPositionedFlown(wp: Waypoint): boolean {
  return (
    isFlownCommand(wp.command) &&
    wp.command !== "RTL" &&
    !wp.inheritsPosition &&
    !(wp.lat === 0 && wp.lon === 0)
  );
}

/**
 * The legs the vehicle flies, as `[fromIndex, toIndex]` pairs of consecutive
 * positioned waypoints, ending at the first LAND, VTOL_LAND or RTL (nothing
 * after it executes).
 */
export function flownLegs(waypoints: readonly Waypoint[]): Array<[number, number]> {
  const legs: Array<[number, number]> = [];
  let prev = -1;
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (isPositionedFlown(wp)) {
      if (prev !== -1) legs.push([prev, i]);
      prev = i;
    }
    if (TERMINAL[wp.command ?? "WAYPOINT"]) break;
  }
  return legs;
}

/** Inputs for {@link legTerrainIssues}. */
export interface LegTerrainInput {
  /** The waypoints as the vehicle flies them (altitudes already effective). */
  waypoints: readonly Waypoint[];
  datums: AltitudeDatums;
  minClearance: number;
  profiles?: LegGroundProfiles;
}

/**
 * Check every flown leg against its ground profile.
 *
 * The path between two waypoints is a straight line between their resolved
 * heights. Between two terrain-frame waypoints ArduPilot follows the terrain,
 * so the height above ground is interpolated instead. A leg into LAND is flown
 * level at the previous height and the descent happens at the landing point.
 * Only the samples between the endpoints are checked; the endpoints are the
 * per-waypoint clearance rule's.
 */
export function legTerrainIssues(input: LegTerrainInput): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const { waypoints, datums, minClearance, profiles } = input;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const unchecked: Array<[number, number]> = [];

  for (const [a, b] of flownLegs(waypoints)) {
    const from = waypoints[a];
    const to = waypoints[b];
    const ground = profiles?.get(`${from.id}>${to.id}`);
    if (!ground || ground.length < 2) {
      unchecked.push([a, b]);
      continue;
    }
    const n = ground.length;
    const fromAlt = resolveWaypointAltitude(from, datums, ground[0]);
    const toAlt = resolveWaypointAltitude(to, datums, ground[n - 1]);
    const landing = LANDING[to.command ?? "WAYPOINT"] === true;
    const followsTerrain = fromAlt.frame === "terrain" && toAlt.frame === "terrain" && !landing;
    const fromMsl = fromAlt.msl;
    const toMsl = landing ? fromMsl : toAlt.msl;
    if (!followsTerrain && (fromMsl === null || toMsl === null)) {
      unchecked.push([a, b]);
      continue;
    }

    const length = haversineDistance(from.lat, from.lon, to.lat, to.lon);
    const samples: ClearanceSample[] = [];
    for (let k = 1; k < n - 1; k++) {
      const t = k / (n - 1);
      const agl = followsTerrain
        ? (fromAlt.agl as number) + t * ((toAlt.agl as number) - (fromAlt.agl as number))
        : (fromMsl as number) + t * ((toMsl as number) - (fromMsl as number)) - ground[k];
      samples.push({ distance: t * length, agl });
    }
    const segments = findCollisionSegments(samples, minClearance);
    if (segments.length === 0) continue;
    const worst = segments.reduce((w, s) => (s.minAgl < w.minAgl ? s : w));
    const at = samples.find((s) => s.agl === worst.minAgl) ?? samples[0];
    const along = Math.round(at.distance);
    const detail = at.agl < 0
      ? `clips terrain by ${Math.round(-at.agl)}m`
      : `only ${Math.round(at.agl)}m above terrain`;
    errors.push({
      severity: "blocking",
      code: "LEG_TERRAIN_CLEARANCE",
      message: `WP${a + 1} to WP${b + 1}: ${detail} ${along}m along the leg (min: ${minClearance}m)`,
      text: { key: "wpToWPMAlongThe", params: { v0: a + 1, v1: b + 1, v2: detail, v3: along, v4: minClearance } },
      waypointIndex: a,
      waypointId: from.id,
      leg: { toWaypointId: to.id, clearanceM: at.agl, alongM: at.distance },
    });
  }

  if (unchecked.length > 0) {
    const [a, b] = unchecked[0];
    warnings.push({
      severity: "advisory",
      code: "LEG_TERRAIN_UNCHECKED",
      message:
        unchecked.length === 1
          ? `WP${a + 1} to WP${b + 1}: terrain along the leg not checked (no ground profile or home elevation yet)`
          : `Terrain along ${unchecked.length} legs not checked, starting WP${a + 1} to WP${b + 1} (no ground profile or home elevation yet)`,
      text: unchecked.length === 1
        ? { key: "legTerrainUnchecked", params: { from: a + 1, to: b + 1 } }
        : { key: "legsTerrainUnchecked", params: { count: unchecked.length, from: a + 1, to: b + 1 } },
      waypointIndex: a,
      waypointId: waypoints[a].id,
    });
  }
  return { errors, warnings };
}
