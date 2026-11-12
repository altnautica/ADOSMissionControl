/**
 * @module mission-validator
 * @description Validates mission waypoints for the conditions that make a
 * mission unsafe or un-flyable: terrain clearance in the correct altitude
 * frame (at each waypoint and along each leg), geofence containment
 * (horizontal and vertical), takeoff/land structure, jump reachability,
 * identity collisions, RTL return clearance, link range, turn feasibility,
 * and what the target autopilot stores and accepts.
 *
 * Every issue carries an explicit `severity`: `blocking` means do not fly this,
 * `advisory` means look at this. `errors` / `warnings` are those two buckets.
 *
 * FLIGHT-SAFETY-CRITICAL: altitude comparisons go through
 * `mission/altitude-frame`, never through raw `wp.alt`. A `relative`-frame
 * altitude is above HOME, not above ground — treating it as AGL made a mission
 * that clips a ridge validate clean. When the datum needed to resolve a frame is
 * unavailable, the rule reports loudly rather than skipping: an unchecked
 * terrain rule that renders as a green tick is worse than no rule at all.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import { bearing } from "@/lib/telemetry-utils";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { isActionCommand } from "@/lib/mission/command-classes";
import { planLaunchPoint } from "@/lib/mission/plan-home";
import {
  inferHomeGroundElevation,
  resolveWaypointAltitude,
  type AltitudeDatums,
} from "@/lib/mission/altitude-frame";
import { haversineDistance } from "@/lib/geo/distance";
import { legFenceIssues } from "./leg-fence";
import { isPositionedFlown, legTerrainIssues } from "./leg-terrain";
import { jumpIssues } from "./jump-rules";
import { autopilotIssues, effectiveWaypoints, isArduCopter, noLandMessage, noLandText } from "./autopilot-rules";
import { fenceAndRallyIssues, fenceItemCount, waypointFenceIssues } from "./fence-rules";
import { waypointIssues } from "./waypoint-rules";
import type { ValidationIssue, ValidationOptions, ValidationResult } from "./issue-types";

/** Commands that end a mission, after which later items never execute. */
const TERMINAL_COMMANDS: Record<string, true> = { LAND: true, VTOL_LAND: true, RTL: true };

/** Commands that launch the vehicle. */
const TAKEOFF_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };

/**
 * Largest circular-arc radius that fits between two legs meeting at a vertex.
 *
 * A fillet of radius `r` tangent to both legs consumes `r * tan(Δ/2)` of each
 * leg, where `Δ` is the course change. The fillet fits when that tangent length
 * is at most half the shorter leg, so the largest feasible radius is
 * `min(legIn, legOut) / (2 * tan(Δ/2))`. Returns `Infinity` for a straight-
 * through vertex (no turn needed) and `0` for a reversal.
 */
function feasibleTurnRadius(legIn: number, legOut: number, courseChangeRad: number): number {
  const half = courseChangeRad / 2;
  if (half <= 1e-6) return Infinity;
  if (Math.abs(Math.PI / 2 - half) < 1e-6) return 0;
  const t = Math.tan(half);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return Math.min(legIn, legOut) / (2 * t);
}

/**
 * Validate a mission's waypoints.
 *
 * @param waypoints Array of mission waypoints
 * @param options Optional validation parameters (geofence, altitude limits, etc.)
 * @returns Blocking and advisory issues, plus `valid` (nothing blocking)
 */
export function validateMission(
  waypoints: Waypoint[],
  options?: ValidationOptions,
): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const maxDist = options?.maxDistanceBetweenWps ?? 50_000; // 50km default
  const minClearance = options?.minTerrainClearance ?? DEFAULT_MIN_TERRAIN_CLEARANCE;
  const profile = options?.profile;

  // 1. Empty mission
  if (waypoints.length === 0) {
    errors.push({
      severity: "blocking",
      code: "EMPTY_MISSION",
      message: "Mission has no waypoints",
      text: { key: "missionHasNoWaypoints" },
    });
    return { valid: false, warnings, errors };
  }

  // The planned home is the plan's own datum. Without one, the launch point
  // stands in for its position and the launch waypoint's terrain for its ground.
  const home = options?.home;
  const launch = planLaunchPoint(waypoints);
  const homeLat = home?.lat ?? launch?.lat;
  const homeLon = home?.lon ?? launch?.lon;
  const homeGroundElevation =
    home?.groundElevation ?? inferHomeGroundElevation(waypoints);
  const datums: AltitudeDatums = {
    homeGroundElevation,
    defaultFrame: options?.defaultFrame,
  };

  /** The waypoints with the altitude the vehicle holds (ArduCopter keeps the previous altitude for 0). */
  const flown = effectiveWaypoints(waypoints, profile);
  /** Resolved altitude per waypoint, computed once and reused by every rule. */
  const resolved = flown.map((wp) => resolveWaypointAltitude(wp, datums));

  // 2. Less than 2 waypoints
  if (waypoints.length < 2) {
    warnings.push({
      severity: "advisory",
      code: "TOO_FEW_WAYPOINTS",
      message: "Mission has only 1 waypoint. Add at least 2 for a meaningful mission.",
      text: { key: "missionHasOnly1WaypointAdd" },
      waypointIndex: 0,
      waypointId: waypoints[0].id,
    });
  }

  // 3. First waypoint should be TAKEOFF or VTOL_TAKEOFF
  const firstCmd = waypoints[0].command ?? "WAYPOINT";
  if (!TAKEOFF_COMMANDS[firstCmd]) {
    const first = { waypointIndex: 0, waypointId: waypoints[0].id };
    // A mission whose first waypoint is already at altitude has no launch
    // command at all: the vehicle would fly toward a point it is not at yet.
    // PX4 climbs to MIS_TAKEOFF_ALT by itself first, so there it is advisory.
    const startsAirborne = (resolved[0].agl ?? resolved[0].aboveHome ?? waypoints[0].alt) > 0;
    const airborne = `WP1: mission starts airborne (${Math.round(waypoints[0].alt)}m, ${resolved[0].frame} frame) with no TAKEOFF command`;
    const airborneParams = { alt: Math.round(waypoints[0].alt), frame: resolved[0].frame };
    if (startsAirborne && profile?.autopilot === "px4") {
      warnings.push({ severity: "advisory", code: "MISSING_TAKEOFF", message: `${airborne}. PX4 climbs to MIS_TAKEOFF_ALT first`, text: { key: "startsAirbornePx4", params: airborneParams }, ...first });
    } else if (startsAirborne) {
      errors.push({ severity: "blocking", code: "MISSING_TAKEOFF", message: airborne, text: { key: "startsAirborne", params: airborneParams }, ...first });
    } else if (isArduCopter(profile)) {
      errors.push({
        severity: "blocking",
        code: "NO_TAKEOFF",
        message: "First waypoint is not TAKEOFF. ArduCopter will not start AUTO on the ground without a TAKEOFF",
        text: { key: "firstWaypointIsNotTAKEOFFArduCopter" },
        ...first,
      });
    } else {
      warnings.push({
        severity: "advisory",
        code: "NO_TAKEOFF",
        message: "First waypoint is not TAKEOFF. The drone may not launch correctly.",
        text: { key: "firstWaypointIsNotTAKEOFFThe" },
        ...first,
      });
    }
  }

  // 4. Last waypoint should be LAND, VTOL_LAND, or RTL
  if (waypoints.length >= 2) {
    const lastCmd = waypoints[waypoints.length - 1].command ?? "WAYPOINT";
    if (!TERMINAL_COMMANDS[lastCmd]) {
      warnings.push({
        severity: "advisory",
        code: "NO_LAND",
        message: noLandMessage(profile),
        text: noLandText(profile),
        waypointIndex: waypoints.length - 1,
        waypointId: waypoints[waypoints.length - 1].id,
      });
    }
  }

  // 5. Identity collisions. A waypoint's id IS its sequence identity: DO_JUMP
  // targets resolve by id and the wire sequence is derived from list order, so
  // two rows sharing an id make the jump target and the row identity ambiguous.
  const seenIds = new Set<string>();
  for (let i = 0; i < waypoints.length; i++) {
    const id = waypoints[i].id;
    if (seenIds.has(id)) {
      errors.push({
        severity: "blocking",
        code: "DUPLICATE_SEQUENCE",
        message: `WP${i + 1}: duplicate waypoint id "${id}" — the mission sequence is ambiguous`,
        text: { key: "wpDuplicateWaypointIdTheMission", params: { v0: i + 1, v1: id } },
        waypointIndex: i,
        waypointId: id,
      });
    }
    seenIds.add(id);
  }

  // 6. Home datum. Every relative-frame altitude resolves against terrain at
  // home; with no sample there, terrain clearance cannot be computed at all.
  const usesRelative = resolved.some((r) => r.frame === "relative");
  if (homeGroundElevation === undefined && usesRelative) {
    warnings.push({
      severity: "advisory",
      code: "HOME_NOT_SET",
      message:
        "No home terrain elevation: relative-frame altitudes cannot be checked against terrain. Set home or wait for an elevation sample.",
      text: { key: "homeNotSet" },
    });
  }

  // The previous waypoint flown to at its own coordinates. RTL, items placed
  // at run time (0,0) and actions have no position of their own, so distance
  // and link-range rules measure between positioned waypoints only.
  let prevPositioned = -1;

  // Per-waypoint checks
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const alt = resolved[i];
    const positioned = isPositionedFlown(wp);

    // 7. An action command (DO_/CONDITION_) has no leg of its own and must be
    // attached to a navigation waypoint, never placed as its own top-level row.
    if (wp.command && isActionCommand(wp.command)) {
      errors.push({
        severity: "blocking",
        code: "ACTION_AS_NAV",
        message: `WP${i + 1}: ${wp.command} is an action and must be attached to a waypoint, not placed on its own`,
        text: { key: "wpIsAnActionAndMust", params: { v0: i + 1, v1: wp.command } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    }

    // 8. Valid coordinates
    if (wp.lat < -90 || wp.lat > 90 || wp.lon < -180 || wp.lon > 180) {
      errors.push({
        severity: "blocking",
        code: "INVALID_COORDS",
        message: `WP${i + 1}: Invalid coordinates (${wp.lat.toFixed(4)}, ${wp.lon.toFixed(4)})`,
        text: { key: "wpInvalidCoordinates", params: { v0: i + 1, v1: wp.lat.toFixed(4), v2: wp.lon.toFixed(4) } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    }

    // 9-10. Fence ceiling and floor, terrain clearance, action locations.
    const own = waypointIssues(wp, i, alt, options, minClearance);
    errors.push(...own.errors);
    warnings.push(...own.warnings);

    // 11-13. Fence containment: primary polygon or circle, and every zone.
    errors.push(...waypointFenceIssues(wp, i, options?.geofence));

    // 13b. The leg into this waypoint: both ends can sit on the right side of
    // a fence while the straight line the vehicle flies between them does not.
    if (i > 0) errors.push(...legFenceIssues(waypoints[i - 1], wp, i, options?.geofence));

    // 14. Leg distance rules between positioned waypoints: duplicate point,
    // absurd leg, and a leg longer than the usable link range.
    if (positioned && prevPositioned !== -1) {
      const prev = waypoints[prevPositioned];
      const legName = `WP${prevPositioned + 1} to WP${i + 1}`;
      const dist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      // The vehicle climbs at a takeoff and then flies to the next point, so a
      // shared position is not a duplicate.
      if (dist < 0.5 && !TAKEOFF_COMMANDS[prev.command ?? "WAYPOINT"]) {
        warnings.push({
          severity: "advisory",
          code: "DUPLICATE_WAYPOINT",
          message: `WP${i + 1}: Duplicate of WP${prevPositioned + 1} (${dist.toFixed(1)}m apart)`,
          text: { key: "wpDuplicateOfWPMApart", params: { v0: i + 1, v1: prevPositioned + 1, v2: dist.toFixed(1) } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
      if (dist > maxDist) {
        warnings.push({
          severity: "advisory",
          code: "EXCESSIVE_DISTANCE",
          message: `${legName}: ${(dist / 1000).toFixed(1)}km apart (max: ${(maxDist / 1000).toFixed(0)}km)`,
          text: { key: "kmApartMaxKm", params: { v0: legName, v1: (dist / 1000).toFixed(1), v2: (maxDist / 1000).toFixed(0) } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
      if (options?.linkRangeM !== undefined && options.linkRangeM > 0 && dist > options.linkRangeM) {
        warnings.push({
          severity: "advisory",
          code: "LEG_EXCEEDS_LINK_RANGE",
          message: `${legName}: ${Math.round(dist)}m leg exceeds the ${Math.round(options.linkRangeM)}m link range`,
          text: { key: "mLegExceedsTheMLink", params: { v0: legName, v1: Math.round(dist), v2: Math.round(options.linkRangeM) } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 15. Distance from home against the link range (the point at which
    // command and telemetry stop reaching the vehicle) and against ArduPilot's
    // home-centred circle fence. Skipped with no home and no launch point.
    if (positioned && homeLat !== undefined && homeLon !== undefined) {
      const fromHome = haversineDistance(homeLat, homeLon, wp.lat, wp.lon);
      if (options?.linkRangeM !== undefined && options.linkRangeM > 0 && fromHome > options.linkRangeM) {
        warnings.push({
          severity: "advisory",
          code: "OUTSIDE_LINK_RANGE",
          message: `WP${i + 1}: ${Math.round(fromHome)}m from home, beyond the ${Math.round(options.linkRangeM)}m link range`,
          text: { key: "wpMFromHomeBeyondThe", params: { v0: i + 1, v1: Math.round(fromHome), v2: Math.round(options.linkRangeM) } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
      const circle = options?.homeCircleRadiusM;
      if (circle !== undefined && circle > 0 && fromHome > circle) {
        errors.push({
          severity: "blocking",
          code: "OUTSIDE_HOME_CIRCLE_FENCE",
          message: `WP${i + 1}: ${Math.round(fromHome)}m from home, outside the ${Math.round(circle)}m home circle fence (FENCE_RADIUS)`,
          text: { key: "wpMFromHomeOutsideThe", params: { v0: i + 1, v1: Math.round(fromHome), v2: Math.round(circle) } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }
    if (positioned) prevPositioned = i;

    // 16. Turn feasibility. A vertex whose largest fitting arc is tighter than
    // the vehicle's minimum turn radius cannot be flown as drawn — the vehicle
    // overshoots and re-attacks, which ruins a survey grid.
    const minRadius = options?.vehicle?.minTurnRadiusM;
    if (minRadius !== undefined && minRadius > 0 && i > 0 && i < waypoints.length - 1) {
      const prev = waypoints[i - 1];
      const next = waypoints[i + 1];
      const legIn = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      const legOut = haversineDistance(wp.lat, wp.lon, next.lat, next.lon);
      if (legIn > 0.5 && legOut > 0.5) {
        const inBearing = bearing(prev.lat, prev.lon, wp.lat, wp.lon);
        const outBearing = bearing(wp.lat, wp.lon, next.lat, next.lon);
        let change = Math.abs(outBearing - inBearing) % 360;
        if (change > 180) change = 360 - change;
        const feasible = feasibleTurnRadius(legIn, legOut, (change * Math.PI) / 180);
        if (feasible < minRadius) {
          warnings.push({
            severity: "advisory",
            code: "TURN_RADIUS_TOO_TIGHT",
            message: `WP${i + 1}: ${Math.round(change)}° turn needs a ${Math.round(feasible)}m radius but the vehicle minimum is ${Math.round(minRadius)}m`,
            text: { key: "wpTurnNeedsAMRadius", params: { v0: i + 1, v1: Math.round(change), v2: Math.round(feasible), v3: Math.round(minRadius) } },
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      }
    }
  }

  // 19. Jumps: a real target, a way out of loops, and a jump the autopilot takes.
  const jumps = jumpIssues(waypoints, profile);
  errors.push(...jumps.errors);
  warnings.push(...jumps.warnings);

  // 20. Terrain between waypoints, along each flown leg.
  const legs = legTerrainIssues({
    waypoints: flown,
    datums,
    minClearance,
    profiles: options?.legGroundProfiles,
  });
  errors.push(...legs.errors);
  warnings.push(...legs.warnings);

  // 21. RTL return clearance. The return cruise sits at `homeGround + rtlAlt`
  // (RTL altitude is relative to home on both ArduPilot and PX4). The vehicle
  // overflies the mission area on the way back, so the highest ground the
  // mission sampled bounds the terrain it must clear.
  if (options?.rtlAltitude !== undefined && homeGroundElevation !== undefined) {
    let highestGround = -Infinity;
    let highestIndex = -1;
    for (let i = 0; i < waypoints.length; i++) {
      const g = waypoints[i].groundElevation;
      if (g !== undefined && Number.isFinite(g) && g > highestGround) {
        highestGround = g;
        highestIndex = i;
      }
    }
    if (highestIndex !== -1) {
      const cruiseMsl = homeGroundElevation + options.rtlAltitude;
      const clearance = cruiseMsl - highestGround;
      if (clearance < minClearance) {
        errors.push({
          severity: "blocking",
          code: "RTL_ALTITUDE_LOW",
          message: `RTL altitude ${Math.round(options.rtlAltitude)}m above home clears the highest terrain on the return path (WP${highestIndex + 1}, ${Math.round(highestGround)}m MSL) by only ${Math.round(clearance)}m (min: ${minClearance}m)`,
          text: { key: "rtlAltitudeMAboveHomeClears", params: { v0: Math.round(options.rtlAltitude), v1: highestIndex + 1, v2: Math.round(highestGround), v3: Math.round(clearance), v4: minClearance } },
          waypointIndex: highestIndex,
          waypointId: waypoints[highestIndex].id,
        });
      }
    }
  }

  // 22. Fence shape and rally points.
  const fenceRally = fenceAndRallyIssues(options?.geofence, options?.rally ?? []);
  errors.push(...fenceRally.errors);
  warnings.push(...fenceRally.warnings);

  // 23. What the target autopilot stores and accepts.
  if (profile) {
    const ap = autopilotIssues({
      waypoints,
      resolved,
      profile,
      terrainEnabled: options?.terrainEnabled,
      rtlAutoland: options?.rtlAutoland,
      defaultSpeed: options?.defaultSpeed,
      fenceItemCount: fenceItemCount(options?.geofence),
      rallyCount: options?.rally?.length ?? 0,
    });
    errors.push(...ap.errors);
    warnings.push(...ap.warnings);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
