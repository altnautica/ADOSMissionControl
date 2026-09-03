/**
 * @module mission-validator
 * @description Validates mission waypoints for the conditions that make a
 * mission unsafe or un-flyable: terrain clearance in the correct altitude
 * frame, geofence containment (horizontal and vertical), takeoff/land structure,
 * jump reachability, identity collisions, RTL return clearance, link range and
 * turn feasibility.
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

import type { AltitudeFrame, Waypoint } from "@/lib/types";
import type { FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import { haversineDistance, bearing } from "@/lib/telemetry-utils";
import { pointInPolygon, isSelfIntersecting } from "@/lib/drawing/geo-utils";
import { DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { isActionCommand } from "@/lib/mission/command-classes";
import {
  inferHomeGroundElevation,
  resolveWaypointAltitude,
  type AltitudeDatums,
} from "@/lib/mission/altitude-frame";

/** How much a mission issue matters. */
export type ValidationSeverity =
  /** Do not fly: the mission is unsafe or will not execute as drawn. */
  | "blocking"
  /** Look at this: the mission is flyable but something is worth checking. */
  | "advisory";

/** A single validation issue. */
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  waypointIndex?: number;
  waypointId?: string;
}

/** Complete validation result. */
export interface ValidationResult {
  /** True when nothing blocking was found. Advisories do not affect this. */
  valid: boolean;
  /** Advisory issues. */
  warnings: ValidationIssue[];
  /** Blocking issues. */
  errors: ValidationIssue[];
}

/** Commands that end a mission, after which later items never execute. */
const TERMINAL_COMMANDS: Record<string, true> = { LAND: true, VTOL_LAND: true, RTL: true };

/** Commands that launch the vehicle. */
const TAKEOFF_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };

/** Options for mission validation. */
export interface ValidationOptions {
  geofence?: {
    polygonPoints?: [number, number][];
    circleCenter?: [number, number];
    circleRadius?: number;
    /**
     * Fence ceiling in metres ABOVE HOME (`FENCE_ALT_MAX` semantics). Waypoint
     * altitudes are normalised into that datum before comparison.
     */
    maxAltitude?: number;
    /** Fence floor in metres above home (`FENCE_ALT_MIN`). Below this = blocking. */
    minAltitude?: number;
    /** Multi-zone inclusion/exclusion fences (independent of the primary fence). */
    zones?: FenceZone[];
  };
  /** Hard ceiling in metres above home, same datum as the fence ceiling. */
  maxAltitude?: number;
  maxDistanceBetweenWps?: number;
  /** Minimum AGL clearance in meters. Defaults to 5m. */
  minTerrainClearance?: number;
  /** Rally points to validate (containment + altitude band). */
  rally?: RallyPoint[];
  /**
   * The launch point. `groundElevation` (terrain MSL at home) is the datum every
   * `relative`-frame altitude resolves against; without it a relative mission
   * cannot be checked against terrain and the rule says so.
   */
  home?: { lat?: number; lon?: number; groundElevation?: number };
  /** Mission default altitude frame for waypoints carrying none. */
  defaultFrame?: AltitudeFrame;
  /** RTL return altitude in metres above home, when configured. */
  rtlAltitude?: number;
  /** Usable command/telemetry link range in metres, when configured. */
  linkRangeM?: number;
  /** Vehicle limits that make a drawn path un-flyable. */
  vehicle?: {
    /** Minimum turn radius in metres (fixed wing / VTOL in forward flight). */
    minTurnRadiusM?: number;
  };
}

/**
 * Whether a point falls inside a fence zone (polygon or circle).
 * Returns false for a malformed zone (too few polygon points / no circle center).
 */
function pointInZone(lat: number, lon: number, zone: FenceZone): boolean {
  if (zone.type === "polygon") {
    if (zone.polygonPoints.length < 3) return false;
    return pointInPolygon([lat, lon], zone.polygonPoints);
  }
  if (!zone.circleCenter) return false;
  const dist = haversineDistance(lat, lon, zone.circleCenter[0], zone.circleCenter[1]);
  return dist <= zone.circleRadius;
}

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
  // Stable ids of every waypoint, for resolving DO_JUMP targets by id.
  const waypointIds = new Set(waypoints.map((w) => w.id));
  const indexById = new Map(waypoints.map((w, i) => [w.id, i]));

  // 1. Empty mission
  if (waypoints.length === 0) {
    errors.push({
      severity: "blocking",
      code: "EMPTY_MISSION",
      message: "Mission has no waypoints",
    });
    return { valid: false, warnings, errors };
  }

  // Vertical datums. Home ground elevation is either supplied by the caller or
  // inferred from the launch point's own terrain sample; without it no
  // relative-frame altitude can be resolved to a real height.
  const homeGroundElevation =
    options?.home?.groundElevation ?? inferHomeGroundElevation(waypoints);
  const datums: AltitudeDatums = {
    homeGroundElevation,
    defaultFrame: options?.defaultFrame,
  };
  const homeLat = options?.home?.lat ?? waypoints[0].lat;
  const homeLon = options?.home?.lon ?? waypoints[0].lon;

  /** Resolved altitude per waypoint, computed once and reused by every rule. */
  const resolved = waypoints.map((wp) => resolveWaypointAltitude(wp, datums));

  // 2. Less than 2 waypoints
  if (waypoints.length < 2) {
    warnings.push({
      severity: "advisory",
      code: "TOO_FEW_WAYPOINTS",
      message: "Mission has only 1 waypoint. Add at least 2 for a meaningful mission.",
      waypointIndex: 0,
      waypointId: waypoints[0].id,
    });
  }

  // 3. First waypoint should be TAKEOFF or VTOL_TAKEOFF
  const firstCmd = waypoints[0].command ?? "WAYPOINT";
  if (!TAKEOFF_COMMANDS[firstCmd]) {
    // A mission whose first waypoint is already at altitude has no launch
    // command at all: the vehicle would fly toward a point it is not at yet.
    // That is a different, blocking, defect from a merely absent TAKEOFF row.
    const startsAirborne = (resolved[0].agl ?? resolved[0].aboveHome ?? waypoints[0].alt) > 0;
    if (startsAirborne) {
      errors.push({
        severity: "blocking",
        code: "MISSING_TAKEOFF",
        message: `WP1: mission starts airborne (${Math.round(waypoints[0].alt)}m, ${resolved[0].frame} frame) with no TAKEOFF command`,
        waypointIndex: 0,
        waypointId: waypoints[0].id,
      });
    } else {
      warnings.push({
        severity: "advisory",
        code: "NO_TAKEOFF",
        message: "First waypoint is not TAKEOFF. The drone may not launch correctly.",
        waypointIndex: 0,
        waypointId: waypoints[0].id,
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
        message: "Last waypoint is not LAND or RTL. The drone may hover at the final waypoint.",
        waypointIndex: waypoints.length - 1,
        waypointId: waypoints[waypoints.length - 1].id,
      });
    }
  }

  // Index of the first terminal command: anything after it never executes, so a
  // jump into that region targets dead mission.
  const firstTerminalIndex = waypoints.findIndex((w) => TERMINAL_COMMANDS[w.command ?? "WAYPOINT"]);

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
    });
  }

  // Per-waypoint checks
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    const alt = resolved[i];
    const wpCommand = wp.command ?? "WAYPOINT";

    // 7. An action command (DO_/CONDITION_) has no leg of its own and must be
    // attached to a navigation waypoint, never placed as its own top-level row.
    if (wp.command && isActionCommand(wp.command)) {
      errors.push({
        severity: "blocking",
        code: "ACTION_AS_NAV",
        message: `WP${i + 1}: ${wp.command} is an action and must be attached to a waypoint, not placed on its own`,
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
        waypointIndex: i,
        waypointId: wp.id,
      });
    }

    // 9. Altitude ceiling. The fence ceiling is expressed above HOME, so the
    // waypoint altitude is normalised into that datum first — comparing a raw
    // MSL altitude against an above-home limit is how a legal mission got
    // rejected and an illegal one passed.
    const altLimit = options?.maxAltitude ?? options?.geofence?.maxAltitude;
    if (altLimit !== undefined) {
      if (alt.aboveHome !== null) {
        if (alt.aboveHome > altLimit) {
          errors.push({
            severity: "blocking",
            code: "ALTITUDE_EXCEEDED",
            message: `WP${i + 1}: Altitude ${Math.round(alt.aboveHome)}m above home exceeds limit of ${altLimit}m`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      } else {
        warnings.push({
          severity: "advisory",
          code: "ALTITUDE_UNCHECKED",
          message: `WP${i + 1}: ${alt.frame}-frame altitude cannot be compared to the ${altLimit}m ceiling without a home elevation`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 10. Fence floor, in the same above-home datum as the ceiling.
    const minAlt = options?.geofence?.minAltitude;
    if (minAlt !== undefined && minAlt > 0 && alt.aboveHome !== null && alt.aboveHome < minAlt) {
      errors.push({
        severity: "blocking",
        code: "BELOW_MIN_ALTITUDE",
        message: `WP${i + 1}: Altitude ${Math.round(alt.aboveHome)}m above home is below the fence floor of ${minAlt}m`,
        waypointIndex: i,
        waypointId: wp.id,
      });
    }

    // 11. Geofence polygon check
    if (options?.geofence?.polygonPoints && options.geofence.polygonPoints.length >= 3) {
      if (!pointInPolygon([wp.lat, wp.lon], options.geofence.polygonPoints)) {
        errors.push({
          severity: "blocking",
          code: "OUTSIDE_GEOFENCE",
          message: `WP${i + 1}: Outside geofence polygon`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 12. Geofence circle check
    if (options?.geofence?.circleCenter && options?.geofence?.circleRadius) {
      const [centerLat, centerLon] = options.geofence.circleCenter;
      const dist = haversineDistance(wp.lat, wp.lon, centerLat, centerLon);
      if (dist > options.geofence.circleRadius) {
        errors.push({
          severity: "blocking",
          code: "OUTSIDE_GEOFENCE",
          message: `WP${i + 1}: ${Math.round(dist)}m from center, exceeds ${options.geofence.circleRadius}m radius`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 13. Multi-zone fences: inclusion = must stay inside, exclusion = must stay outside
    for (const zone of options?.geofence?.zones ?? []) {
      const inside = pointInZone(wp.lat, wp.lon, zone);
      if (zone.role === "inclusion" && !inside) {
        errors.push({
          severity: "blocking",
          code: "OUTSIDE_GEOFENCE",
          message: `WP${i + 1}: Outside inclusion zone`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      } else if (zone.role === "exclusion" && inside) {
        errors.push({
          severity: "blocking",
          code: "INSIDE_EXCLUSION_ZONE",
          message: `WP${i + 1}: Inside a no-fly exclusion zone`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 14. Consecutive-leg distance rules: duplicate point, absurd leg, and a leg
    // longer than the usable link range.
    if (i > 0) {
      const prev = waypoints[i - 1];
      const dist = haversineDistance(prev.lat, prev.lon, wp.lat, wp.lon);
      if (dist < 0.5) {
        warnings.push({
          severity: "advisory",
          code: "DUPLICATE_WAYPOINT",
          message: `WP${i + 1}: Duplicate of WP${i} (${dist.toFixed(1)}m apart)`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
      if (dist > maxDist) {
        warnings.push({
          severity: "advisory",
          code: "EXCESSIVE_DISTANCE",
          message: `WP${i} to WP${i + 1}: ${(dist / 1000).toFixed(1)}km apart (max: ${(maxDist / 1000).toFixed(0)}km)`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
      if (options?.linkRangeM !== undefined && options.linkRangeM > 0 && dist > options.linkRangeM) {
        warnings.push({
          severity: "advisory",
          code: "LEG_EXCEEDS_LINK_RANGE",
          message: `WP${i} to WP${i + 1}: ${Math.round(dist)}m leg exceeds the ${Math.round(options.linkRangeM)}m link range`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

    // 15. Distance from home against the link range: the point at which command
    // and telemetry stop reaching the vehicle.
    if (options?.linkRangeM !== undefined && options.linkRangeM > 0) {
      const fromHome = haversineDistance(homeLat, homeLon, wp.lat, wp.lon);
      if (fromHome > options.linkRangeM) {
        warnings.push({
          severity: "advisory",
          code: "OUTSIDE_LINK_RANGE",
          message: `WP${i + 1}: ${Math.round(fromHome)}m from home, beyond the ${Math.round(options.linkRangeM)}m link range`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }

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
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      }
    }

    // 17. Attached-action validation. Actions ride nested under the waypoint
    // they fire at; a DO_JUMP must resolve to a real, reachable target waypoint
    // (by id, so it survives reorder) and must not loop forever.
    for (const action of wp.actions ?? []) {
      if (action.command === "DO_JUMP") {
        const targetId = action.jumpTargetId;
        if (targetId === undefined || !waypointIds.has(targetId)) {
          errors.push({
            severity: "blocking",
            code: "INVALID_JUMP_TARGET",
            message: `WP${i + 1}: DO_JUMP has no valid target waypoint`,
            waypointIndex: i,
            waypointId: wp.id,
          });
          continue;
        }
        const targetIndex = indexById.get(targetId) ?? -1;
        const repeat = action.param2 ?? 0;
        const backwards = targetIndex <= i;

        // A backwards jump that repeats forever never leaves the loop, so the
        // mission has no end and the vehicle never lands.
        if (backwards && repeat < 0) {
          errors.push({
            severity: "blocking",
            code: "JUMP_LOOP_NO_EXIT",
            message: `WP${i + 1}: DO_JUMP loops back to WP${targetIndex + 1} forever — the mission never reaches a landing`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        } else if (repeat < 0) {
          warnings.push({
            severity: "advisory",
            code: "JUMP_REPEAT_FOREVER",
            message: `WP${i + 1}: DO_JUMP repeat count is negative — the jump repeats forever`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        }

        // A jump into the region after the mission's terminal command targets
        // items the vehicle never executes.
        if (firstTerminalIndex !== -1 && targetIndex > firstTerminalIndex) {
          warnings.push({
            severity: "advisory",
            code: "UNREACHABLE_JUMP_TARGET",
            message: `WP${i + 1}: DO_JUMP targets WP${targetIndex + 1}, which sits after the mission ends at WP${firstTerminalIndex + 1}`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      } else if (action.command === "ROI" || action.command === "DO_SET_HOME") {
        const alat = action.lat ?? 0;
        const alon = action.lon ?? 0;
        if (alat < -90 || alat > 90 || alon < -180 || alon > 180) {
          errors.push({
            severity: "blocking",
            code: "INVALID_ACTION_COORDS",
            message: `WP${i + 1}: ${action.command} has invalid coordinates`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      }
    }

    // 18. Terrain clearance, in the waypoint's OWN frame.
    //
    // `relative` is above HOME: clearance is `homeGround + alt - waypointGround`,
    // so a mission crossing rising terrain breaches even with a healthy-looking
    // altitude. `terrain` is already AGL. `absolute` is MSL, so clearance is
    // `alt - waypointGround`. Never skipped silently: when the datum is missing
    // the rule says the check could not run.
    //
    // Ground-contact commands are exempt: a TAKEOFF, LAND, VTOL_LAND or RTL row
    // is deliberately at or bound for the surface, so measuring its clearance
    // above that surface is meaningless and would fire on every mission.
    const groundContact = TAKEOFF_COMMANDS[wpCommand] === true || TERMINAL_COMMANDS[wpCommand] === true;
    if (!groundContact) {
      if (alt.agl !== null) {
        if (alt.agl < minClearance) {
          errors.push({
            severity: "blocking",
            code: "TERRAIN_CLEARANCE",
            message: `WP${i + 1}: Only ${Math.round(alt.agl)}m above terrain (min: ${minClearance}m). Ground: ${Math.round(wp.groundElevation ?? 0)}m MSL`,
            waypointIndex: i,
            waypointId: wp.id,
          });
        }
      } else {
        warnings.push({
          severity: "advisory",
          code: "TERRAIN_UNCHECKED",
          message: `WP${i + 1}: terrain clearance NOT checked — ${
            alt.waypointGroundKnown
              ? "no home elevation for this relative-frame altitude"
              : "no ground elevation sample at this waypoint"
          }`,
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    }
  }

  // 19. RTL return clearance. The return cruise sits at `homeGround + rtlAlt`
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
          waypointIndex: highestIndex,
          waypointId: waypoints[highestIndex].id,
        });
      }
    }
  }

  // 20. Self-intersecting geofence polygon check
  if (options?.geofence?.polygonPoints && options.geofence.polygonPoints.length >= 4) {
    if (isSelfIntersecting(options.geofence.polygonPoints)) {
      warnings.push({
        severity: "advisory",
        code: "SELF_INTERSECTING_FENCE",
        message: "Geofence polygon is self-intersecting. Containment checks may be inaccurate.",
      });
    }
  }

  // 21. Rally point validation — a rally must be a safe return target: inside any
  // inclusion fence, outside every exclusion zone, and within the altitude band.
  const fence = options?.geofence;
  const rallyPoints = options?.rally ?? [];
  for (let r = 0; r < rallyPoints.length; r++) {
    const rp = rallyPoints[r];
    if (rp.lat < -90 || rp.lat > 90 || rp.lon < -180 || rp.lon > 180) {
      errors.push({
        severity: "blocking",
        code: "RALLY_INVALID_COORDS",
        message: `Rally ${r + 1}: Invalid coordinates`,
      });
      continue;
    }
    if (fence?.polygonPoints && fence.polygonPoints.length >= 3 && !pointInPolygon([rp.lat, rp.lon], fence.polygonPoints)) {
      errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside geofence polygon` });
    }
    if (fence?.circleCenter && fence.circleRadius) {
      const dist = haversineDistance(rp.lat, rp.lon, fence.circleCenter[0], fence.circleCenter[1]);
      if (dist > fence.circleRadius) {
        errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside geofence circle` });
      }
    }
    for (const zone of fence?.zones ?? []) {
      const inside = pointInZone(rp.lat, rp.lon, zone);
      if (zone.role === "inclusion" && !inside) {
        errors.push({ severity: "blocking", code: "RALLY_OUTSIDE_GEOFENCE", message: `Rally ${r + 1}: Outside inclusion zone` });
      } else if (zone.role === "exclusion" && inside) {
        errors.push({ severity: "blocking", code: "RALLY_INSIDE_EXCLUSION_ZONE", message: `Rally ${r + 1}: Inside a no-fly exclusion zone` });
      }
    }
    // A rally altitude is above home by definition, so it compares directly.
    if (fence?.maxAltitude !== undefined && fence.maxAltitude > 0 && rp.alt > fence.maxAltitude) {
      warnings.push({ severity: "advisory", code: "RALLY_ALTITUDE", message: `Rally ${r + 1}: Altitude ${rp.alt}m exceeds fence ceiling ${fence.maxAltitude}m` });
    }
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
