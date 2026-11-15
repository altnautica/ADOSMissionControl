/**
 * @module mission-store-persist
 * @description What the mission store writes to IndexedDB, and how an older
 * persisted payload is migrated forward.
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Mission, PlannedHome, PlanPlaceClass, PlanVehicleProfile, Waypoint } from "@/lib/types";
import type { MissionStoreState } from "./mission-store";
import { foldLegacyWaypoints } from "@/lib/mission/flat-rows";
import { migrateWaypointSlots } from "@/lib/mission/waypoint-slot-migration";
import { stampWaypointFrames } from "@/lib/mission/mission-frame";
import { DEFAULT_ALTITUDE_FRAME } from "@/lib/mission/altitude-frame";

/**
 * The execution half of a {@link Mission}, reset to "not running".
 *
 * A persisted mission is a plan. Anything describing what the vehicle is
 * currently doing has to be re-derived from live telemetry, never restored, so
 * these fields are neutralised both on the way out (`partialize`) and on the
 * way in for a payload written before that rule existed (`migrate` v4).
 */
const IDLE_EXECUTION = {
  state: "planning",
  progress: 0,
  currentWaypoint: 0,
  startedAt: undefined,
  completedAt: undefined,
} as const satisfies Partial<Mission>;

/** The subset of mission state written to IndexedDB. */
export interface PersistedMissionState {
  waypoints: Waypoint[];
  activeMission: Mission | null;
  plannedHome: PlannedHome | null;
  vehicleProfile: PlanVehicleProfile | null;
  transitAltM: number | null;
  placeClass: PlanPlaceClass;
}

/**
 * Select what persists.
 *
 * The PLAN half of the mission persists; the EXECUTION half does not.
 * `Mission` carries `state` / `progress` / `currentWaypoint` / `startedAt`
 * alongside the plan, and persisting them verbatim meant a reload with
 * `state: "running"` put `MissionExecutionOverlay` and `OverviewMap`'s mission
 * controls on screen for a mission that is not running, with nothing
 * connected — while the top-level `progress` and `currentWaypoint` (correctly
 * not persisted) read 0. Two surfaces, two answers. `flight-lifecycle` would
 * also stamp the stale mission id and name onto the next flight's record.
 */
export function missionPartialize(
  state: MissionStoreState,
): PersistedMissionState {
  return {
    waypoints: state.waypoints,
    activeMission: state.activeMission
      ? { ...state.activeMission, ...IDLE_EXECUTION }
      : null,
    plannedHome: state.plannedHome,
    vehicleProfile: state.vehicleProfile,
    transitAltM: state.transitAltM,
    placeClass: state.placeClass,
  };
}

/**
 * Migrate a persisted mission payload forward. Each branch is unit-testable in
 * isolation. `defaultFrame` is the planner default frame that was in effect
 * when the payload was written; v6 stamps it onto frameless waypoints.
 */
export function migrateMissionStore(
  persisted: unknown,
  version: number,
  defaultFrame: AltitudeFrame = DEFAULT_ALTITUDE_FRAME,
): Partial<MissionStoreState> {
  const state = persisted as Record<string, unknown>;
  if (version < 2) {
    // v2 retired the suite framework. Strip the dropped ``suiteType`` field off
    // ``activeMission`` so the persisted shape matches the TypeScript
    // interface verbatim rather than relying on excess-property tolerance.
    const active = state.activeMission as Record<string, unknown> | null;
    if (active && "suiteType" in active) {
      delete active.suiteType;
      state.activeMission = active;
    }
  }
  if (version < 3) {
    // v3 nests action commands (DO_/CONDITION_) under the navigation waypoint
    // they fire at. Fold a legacy flat list, where actions were their own
    // top-level rows, into the per-waypoint ``actions[]`` model.
    if (Array.isArray(state.waypoints)) {
      state.waypoints = foldLegacyWaypoints(state.waypoints as Waypoint[]);
    }
  }
  if (version < 4) {
    // v4 stopped persisting live mission-execution state. A payload written by
    // v3 or earlier can still name a running mission, so reset the execution
    // fields on the way in — a persisted record is a plan, never a report of
    // what the vehicle is doing.
    const active = state.activeMission as Record<string, unknown> | null;
    if (active) {
      state.activeMission = { ...active, ...IDLE_EXECUTION };
    }
  }
  if (version < 5) {
    // v5 maps the iNav action onto `command` and moves the LOITER_TURNS /
    // PAYLOAD_PLACE editor values into the slots that reach the right
    // MAVLink parameter.
    if (Array.isArray(state.waypoints)) {
      state.waypoints = migrateWaypointSlots(state.waypoints as Waypoint[]);
    }
  }
  if (version < 6) {
    // v6 stores an explicit frame on every waypoint. A frameless waypoint was
    // flown in the default frame of the day, so pin that frame now; a later
    // change of the default no longer changes what the waypoint means.
    if (Array.isArray(state.waypoints)) {
      state.waypoints = stampWaypointFrames(state.waypoints as Waypoint[], defaultFrame);
    }
  }
  if (version < 7) {
    // v7 adds the plan settings: planned home, vehicle profile and transit
    // altitude. A payload written before them carries none.
    state.plannedHome = null;
    state.vehicleProfile = null;
    state.transitAltM = null;
  }
  return state as Partial<MissionStoreState>;
}
