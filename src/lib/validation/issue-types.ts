/**
 * @module validation/issue-types
 * @description The shapes mission validation produces and accepts: issues,
 * their severity and operator-facing text, the result buckets, and the
 * options that tune the rules.
 *
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, PlanVehicleProfile } from "@/lib/types";
import type { FenceZone } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { LegGroundProfiles } from "./leg-terrain";

/** How much a mission issue matters. */
export type ValidationSeverity =
  /** Do not fly: the mission is unsafe or will not execute as drawn. */
  | "blocking"
  /** Look at this: the mission is flyable but something is worth checking. */
  | "advisory";

/**
 * The operator-facing text of an issue: a key under `planner.issue` and its
 * ICU params. `message` stays as the English rendering for logs and exports.
 */
export interface IssueText {
  key: string;
  params?: Record<string, string | number>;
}

/** A single validation issue. */
export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  text: IssueText;
  waypointIndex?: number;
  waypointId?: string;
  /**
   * For a leg issue: the leg runs from `waypointId` to `toWaypointId`, with the
   * worst clearance (metres, may be negative) found `alongM` metres along it.
   */
  leg?: { toWaypointId: string; clearanceM: number; alongM: number };
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
  /**
   * Regulatory altitude ceiling in metres above home (the operator
   * jurisdiction's limit). Exceeding it is advisory, fence or no fence.
   */
  advisoryCeiling?: number;
  maxDistanceBetweenWps?: number;
  /** Minimum AGL clearance in meters. Defaults to 5m. */
  minTerrainClearance?: number;
  /** Rally points to validate (containment + altitude band). */
  rally?: RallyPoint[];
  /**
   * The plan's planned home. `groundElevation` (terrain MSL at home) is the
   * datum every `relative`-frame altitude resolves against; without it a
   * relative mission cannot be checked against terrain and the rule says so.
   * Absent: the plan's launch point stands in for the position, and the
   * launch waypoint's own terrain sample for the ground.
   */
  home?: { lat?: number; lon?: number; groundElevation?: number };
  /** Mission default altitude frame for waypoints carrying none. */
  defaultFrame?: AltitudeFrame;
  /** Mission default speed: the upload writes a speed item for it. */
  defaultSpeed?: number;
  /** RTL return altitude in metres above home, when configured. */
  rtlAltitude?: number;
  /** Usable command/telemetry link range in metres, when configured. */
  linkRangeM?: number;
  /** Vehicle limits that make a drawn path un-flyable. */
  vehicle?: {
    /** Minimum turn radius in metres (fixed wing / VTOL in forward flight). */
    minTurnRadiusM?: number;
  };
  /** Autopilot and vehicle class the plan is written for; absent = rules common to all autopilots only. */
  profile?: PlanVehicleProfile;
  /** The connected ArduPilot vehicle's TERRAIN_ENABLE; absent when unknown. */
  terrainEnabled?: boolean;
  /** The connected ArduPlane's RTL_AUTOLAND; absent when unknown. */
  rtlAutoland?: number;
  /** Radius of ArduPilot's home-centred circle fence (`FENCE_RADIUS`), metres. */
  homeCircleRadiusM?: number;
  /** Ground AMSL sampled along each flown leg, keyed `${fromId}>${toId}`. */
  legGroundProfiles?: LegGroundProfiles;
}
