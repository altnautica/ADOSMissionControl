/**
 * @module validation/autopilot-rules
 * @description Checks that depend on which autopilot flies the plan: what its
 * mission storage holds, which altitude frames it accepts, and how it stores
 * loiter parameters.
 *
 * @license GPL-3.0-only
 */

import type { PlanVehicleProfile, Waypoint } from "@/lib/types";
import type { ResolvedAltitude } from "@/lib/mission/altitude-frame";
import { isFlownCommand } from "@/lib/mission/command-classes";
import {
  ARDUPILOT_SMALL_BOARD_ITEMS,
  ARDUPILOT_STORAGE_CLASSES,
  FC_ITEM_COUNT_LIMITS,
  missionItemCount,
} from "./fc-item-count";
import type { ValidationIssue } from "./issue-types";

/** Fence items PX4's dataman stores. */
export const PX4_MAX_FENCE_ITEMS = 64;
/** Rally points PX4's dataman stores. */
export const PX4_MAX_RALLY_POINTS = 32;
/** ArduPilot stores a LOITER_TURNS radius above this in 10 m steps. */
const ARDUPILOT_LOITER_RADIUS_STEP_ABOVE_M = 255;

const GROUND_CONTACT: Record<string, true> = {
  TAKEOFF: true, VTOL_TAKEOFF: true, LAND: true, VTOL_LAND: true, RTL: true,
};

/**
 * A command deliberately at or bound for the surface (takeoff, landing, RTL).
 * Its terrain clearance is not a hazard: the validator exempts it, and the
 * outline must not paint it as one.
 */
export function isGroundContactCommand(command: string | undefined): boolean {
  return command !== undefined && GROUND_CONTACT[command] === true;
}

/** True when ArduCopter flies the plan. */
export function isArduCopter(profile: PlanVehicleProfile | undefined): boolean {
  return profile?.autopilot === "ardupilot" && profile.vehicleClass === "copter";
}

/**
 * The waypoints with the altitude the vehicle actually holds. ArduCopter
 * reads an altitude of 0 on a waypoint or loiter as "keep the previous target
 * altitude", so such a waypoint takes the previous flown waypoint's altitude
 * and frame. Other autopilots fly to the altitude as written.
 */
export function effectiveWaypoints(
  waypoints: readonly Waypoint[],
  profile: PlanVehicleProfile | undefined,
): readonly Waypoint[] {
  if (!isArduCopter(profile)) return waypoints;
  let prev: Waypoint | undefined;
  return waypoints.map((wp) => {
    const command = wp.command ?? "WAYPOINT";
    if (!isFlownCommand(command)) return wp;
    const held = wp.alt === 0 && prev !== undefined && !GROUND_CONTACT[command]
      ? { ...wp, alt: prev.alt, frame: prev.frame }
      : wp;
    prev = held;
    return held;
  });
}

/** What the autopilot does when the mission ends without LAND or RTL. */
export function noLandMessage(profile: PlanVehicleProfile | undefined): string {
  if (profile?.autopilot === "ardupilot") {
    if (profile.vehicleClass === "plane" || profile.vehicleClass === "vtol") {
      return "Last waypoint is not LAND or RTL. ArduPlane switches to RTL at mission end.";
    }
    if (profile.vehicleClass === "rover") return "Last waypoint is not RTL. The rover holds at the last waypoint.";
    return "Last waypoint is not LAND or RTL. ArduCopter hovers at the last waypoint.";
  }
  if (profile?.autopilot === "px4") return "Last waypoint is not LAND or RTL. PX4 loiters at the last waypoint.";
  return "Last waypoint is not LAND or RTL. The drone may hover at the final waypoint.";
}

/** The translation key of {@link noLandMessage}'s text. */
export function noLandText(profile: PlanVehicleProfile | undefined): { key: string } {
  if (profile?.autopilot === "ardupilot") {
    if (profile.vehicleClass === "plane" || profile.vehicleClass === "vtol") return { key: "noLandArduPlane" };
    if (profile.vehicleClass === "rover") return { key: "noLandRover" };
    return { key: "noLandArduCopter" };
  }
  if (profile?.autopilot === "px4") return { key: "noLandPx4" };
  return { key: "noLandGeneric" };
}

/** Inputs for {@link autopilotIssues}. */
export interface AutopilotRuleInput {
  waypoints: readonly Waypoint[];
  resolved: readonly ResolvedAltitude[];
  profile: PlanVehicleProfile;
  /** The vehicle's TERRAIN_ENABLE, when connected and read. */
  terrainEnabled?: boolean;
  /** The vehicle's RTL_AUTOLAND, when an ArduPlane is connected and it was read. */
  rtlAutoland?: number;
  /** Mission default speed, for the speed items the upload writes. */
  defaultSpeed?: number;
  /** Fence items the fence upload writes. */
  fenceItemCount: number;
  rallyCount: number;
}

/** Autopilot-specific storage, frame and parameter checks. */
export function autopilotIssues(input: AutopilotRuleInput): {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
} {
  const { waypoints, resolved, profile } = input;
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];
  const px4 = profile.autopilot === "px4";

  // Altitude frame. Only items that carry their own altitude count: RTL and
  // DO_LAND_START have none.
  const terrainIdx: number[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const command = waypoints[i].command ?? "WAYPOINT";
    if (resolved[i].frame === "terrain" && isFlownCommand(command) && command !== "RTL") terrainIdx.push(i);
  }
  if (px4) {
    for (const i of terrainIdx) {
      errors.push({
        severity: "blocking",
        code: "TERRAIN_FRAME_UNSUPPORTED",
        message: `WP${i + 1}: PX4 has no terrain altitude frame. Use Above home, or Follow terrain on patterns`,
        text: { key: "wpPX4HasNoTerrainAltitude", params: { v0: i + 1 } },
        waypointIndex: i,
        waypointId: waypoints[i].id,
      });
    }
  } else if (terrainIdx.length > 0) {
    const i = terrainIdx[0];
    const at = { waypointIndex: i, waypointId: waypoints[i].id };
    if (input.terrainEnabled === false) {
      errors.push({
        severity: "blocking",
        code: "TERRAIN_DATA_SOURCE",
        message: "Terrain-frame waypoints need terrain data on the vehicle, but TERRAIN_ENABLE is 0: the vehicle would switch to RTL",
        text: { key: "terrainFrameWaypointsNeedTerrainData" },
        ...at,
      });
    } else {
      warnings.push({
        severity: "advisory",
        code: "TERRAIN_DATA_SOURCE",
        message: "Needs terrain data on the vehicle (TERRAIN_ENABLE and SD card or GCS terrain)",
        text: { key: "needsTerrainDataOnTheVehicle" },
        ...at,
      });
    }
  }

  // ArduPlane refuses to arm with a DO_LAND_START in the mission while
  // RTL_AUTOLAND is 0 (QuadPlane included: it runs ArduPlane).
  const fixedWing = profile.vehicleClass === "plane" || profile.vehicleClass === "vtol";
  if (!px4 && fixedWing && input.rtlAutoland === 0) {
    const i = waypoints.findIndex((w) => w.command === "DO_LAND_START");
    if (i >= 0) {
      errors.push({
        severity: "blocking",
        code: "LAND_START_NEEDS_AUTOLAND",
        message:
          "The vehicle has RTL_AUTOLAND = 0, so ArduPlane refuses to arm with a DO_LAND_START in the mission. " +
          "Set RTL_AUTOLAND to 1 or 2 to land through it on RTL, or 3 to use it for go-around only",
        text: { key: "landStartNeedsAutoland" },
        waypointIndex: i,
        waypointId: waypoints[i].id,
      });
    }
  }

  // Mission storage.
  if (px4) {
    if (input.fenceItemCount > PX4_MAX_FENCE_ITEMS) {
      errors.push({
        severity: "blocking",
        code: "FENCE_TOO_MANY_ITEMS",
        message: `Geofence uploads ${input.fenceItemCount} items; PX4 stores at most ${PX4_MAX_FENCE_ITEMS}`,
        text: { key: "geofenceUploadsItemsPX4StoresAt", params: { v0: input.fenceItemCount, v1: PX4_MAX_FENCE_ITEMS } },
      });
    }
    if (input.rallyCount > PX4_MAX_RALLY_POINTS) {
      errors.push({
        severity: "blocking",
        code: "RALLY_TOO_MANY_POINTS",
        message: `${input.rallyCount} rally points; PX4 stores at most ${PX4_MAX_RALLY_POINTS}`,
        text: { key: "rallyPointsPX4StoresAtMost", params: { v0: input.rallyCount, v1: PX4_MAX_RALLY_POINTS } },
      });
    }
  } else {
    const count = missionItemCount(waypoints, "ardupilot", input.defaultSpeed);
    const classes = ARDUPILOT_STORAGE_CLASSES.map(
      (c) => `~${c.items.toLocaleString("en-US")} on ${c.storageKb} KB boards`,
    ).join(", ");
    if (count > FC_ITEM_COUNT_LIMITS.ardupilot) {
      errors.push({
        severity: "blocking",
        code: "ITEM_COUNT_EXCEEDED",
        message: `Mission uploads ${count} items including home; ArduPilot boards hold ${classes}`,
        text: { key: "missionUploadsItemsIncludingHomeArduPilot", params: { v0: count, v1: classes } },
      });
    } else if (count > ARDUPILOT_SMALL_BOARD_ITEMS) {
      warnings.push({
        severity: "advisory",
        code: "ITEM_COUNT_STORAGE",
        message: `Mission uploads ${count} items including home. ArduPilot boards hold ${classes}: check your board`,
        text: { key: "missionUploadsItemsIncludingHomeArduPilot2", params: { v0: count, v1: classes } },
      });
    }

    // LOITER_TURNS: turns ride in holdTime, the radius in param2.
    for (let i = 0; i < waypoints.length; i++) {
      const wp = waypoints[i];
      if (wp.command !== "LOITER_TURNS") continue;
      const at = { waypointIndex: i, waypointId: wp.id };
      const turns = wp.holdTime ?? 0;
      if (turns > 1 && !Number.isInteger(turns)) {
        warnings.push({
          severity: "advisory",
          code: "LOITER_TURNS_ROUNDED",
          message: `WP${i + 1}: ${turns} turns is rounded down to ${Math.floor(turns)} turns`,
          text: { key: "wpTurnsIsRoundedDownTo", params: { v0: i + 1, v1: turns, v2: Math.floor(turns) } },
          ...at,
        });
      }
      const radius = Math.abs(wp.param2 ?? 0);
      if (radius > ARDUPILOT_LOITER_RADIUS_STEP_ABOVE_M) {
        warnings.push({
          severity: "advisory",
          code: "LOITER_RADIUS_COARSE",
          message: `WP${i + 1}: a ${Math.round(radius)}m loiter radius is stored in 10 m steps`,
          text: { key: "wpAMLoiterRadiusIs", params: { v0: i + 1, v1: Math.round(radius) } },
          ...at,
        });
      }
    }
  }
  return { errors, warnings };
}
