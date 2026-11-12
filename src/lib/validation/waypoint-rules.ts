/**
 * @module validation/waypoint-rules
 * @description Checks on a single waypoint's altitude and attached actions:
 * the fence ceiling and floor (both above home), terrain clearance in the
 * waypoint's own frame, and position-bearing actions that need a real place.
 *
 * FLIGHT-SAFETY-CRITICAL: every comparison uses the altitude resolved through
 * `mission/altitude-frame`, never raw `wp.alt`.
 *
 * @license GPL-3.0-only
 */

import type { Waypoint } from "@/lib/types";
import type { ResolvedAltitude } from "@/lib/mission/altitude-frame";
import type { ValidationIssue, ValidationOptions } from "./issue-types";

const TERMINAL_COMMANDS: Record<string, true> = { LAND: true, VTOL_LAND: true, RTL: true };
const TAKEOFF_COMMANDS: Record<string, true> = { TAKEOFF: true, VTOL_TAKEOFF: true };

/** Altitude, terrain and action-location issues for waypoint `i`. */
export function waypointIssues(
  wp: Waypoint,
  i: number,
  alt: ResolvedAltitude,
  options: ValidationOptions | undefined,
  minClearance: number,
): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const wpCommand = wp.command ?? "WAYPOINT";

  // Altitude ceiling. The fence ceiling is expressed above HOME, so the
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
          text: { key: "wpAltitudeMAboveHomeExceeds", params: { v0: i + 1, v1: Math.round(alt.aboveHome), v2: altLimit } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    } else {
      warnings.push({
        severity: "advisory",
        code: "ALTITUDE_UNCHECKED",
        message: `WP${i + 1}: ${alt.frame}-frame altitude cannot be compared to the ${altLimit}m ceiling without a home elevation`,
        text: { key: "wpFrameAltitudeCannotBeCompared", params: { v0: i + 1, v1: alt.frame, v2: altLimit } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    }
  }

  // Fence floor, in the same above-home datum as the ceiling.
  const minAlt = options?.geofence?.minAltitude;
  if (minAlt !== undefined && minAlt > 0 && alt.aboveHome !== null && alt.aboveHome < minAlt) {
    errors.push({
      severity: "blocking",
      code: "BELOW_MIN_ALTITUDE",
      message: `WP${i + 1}: Altitude ${Math.round(alt.aboveHome)}m above home is below the fence floor of ${minAlt}m`,
      text: { key: "wpAltitudeMAboveHomeIs", params: { v0: i + 1, v1: Math.round(alt.aboveHome), v2: minAlt } },
      waypointIndex: i,
      waypointId: wp.id,
    });
  }

  // Position-bearing actions must carry a real location.
  for (const action of wp.actions ?? []) {
    if (action.command !== "ROI" && action.command !== "DO_SET_HOME") continue;
    const alat = action.lat ?? 0;
    const alon = action.lon ?? 0;
    if (alat === 0 && alon === 0) {
      // 0,0 uploads as "clear the ROI" / a home in the ocean off Africa.
      errors.push({
        severity: "blocking",
        code: "ACTION_NO_LOCATION",
        message: `WP${i + 1}: ${action.command} has no location (0, 0); set its latitude and longitude`,
        text: { key: "wpHasNoLocation00", params: { v0: i + 1, v1: action.command } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    } else if (alat < -90 || alat > 90 || alon < -180 || alon > 180) {
      errors.push({
        severity: "blocking",
        code: "INVALID_ACTION_COORDS",
        message: `WP${i + 1}: ${action.command} has invalid coordinates`,
        text: { key: "wpHasInvalidCoordinates", params: { v0: i + 1, v1: action.command } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    }
  }

  // Terrain clearance, in the waypoint's OWN frame.
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
        // A terrain-frame altitude is AGL without a ground sample; never
        // print a ground height that was not measured.
        const ground = alt.waypointGroundKnown && wp.groundElevation !== undefined
          ? `Ground: ${Math.round(wp.groundElevation)}m MSL`
          : "Ground unknown";
        errors.push({
          severity: "blocking",
          code: "TERRAIN_CLEARANCE",
          message: `WP${i + 1}: Only ${Math.round(alt.agl)}m above terrain (min: ${minClearance}m). ${ground}`,
          text: alt.waypointGroundKnown && wp.groundElevation !== undefined
            ? { key: "terrainClearanceGround", params: { v0: i + 1, v1: Math.round(alt.agl), v2: minClearance, ground: Math.round(wp.groundElevation) } }
            : { key: "terrainClearanceGroundUnknown", params: { v0: i + 1, v1: Math.round(alt.agl), v2: minClearance } },
          waypointIndex: i,
          waypointId: wp.id,
        });
      }
    } else {
      // Advisory, but never "clear": a warning keeps the mission out of the
      // green state until the terrain under the waypoint is known.
      warnings.push({
        severity: "advisory",
        code: "TERRAIN_UNCHECKED",
        message: alt.waypointGroundKnown
          ? `WP${i + 1}: terrain clearance not checked — no home elevation for this relative-frame altitude`
          : `WP${i + 1}: terrain unknown — no ground elevation sample at this waypoint, clearance not checked`,
        text: { key: alt.waypointGroundKnown ? "terrainUncheckedNoHome" : "terrainUnknown", params: { wp: i + 1 } },
        waypointIndex: i,
        waypointId: wp.id,
      });
    }
  }

  return { errors, warnings };
}
