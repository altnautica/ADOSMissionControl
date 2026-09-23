/**
 * Mission planning, video, and input types.
 * @module types/mission
 */

// Type-only imports (erased at compile time — no runtime cycle) so a saved plan
// can round-trip its geofence + rally geometry, which live in dedicated stores.
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { PointOfInterest } from "@/stores/plan-poi-store";

export interface Waypoint {
  id: string;
  lat: number;
  lon: number;
  alt: number;         // meters, in the waypoint's altitude frame (relative = above home)
  speed?: number;      // m/s ground speed of the leg into this waypoint; absent = mission default
  holdTime?: number;   // seconds
  command?: WaypointCommand;
  param1?: number;
  param2?: number;
  param3?: number;
  groundElevation?: number;  // terrain elevation MSL at this waypoint
  /**
   * Altitude reference frame for this waypoint. When absent, the mission's
   * default frame applies (relative). Carried through mission file export/import
   * so an absolute-altitude waypoint is never silently downgraded to relative.
   */
  frame?: AltitudeFrame;
  /**
   * Ordered actions performed at (or on the way from) this navigation waypoint.
   * Actions are non-navigation MAVLink commands (set-speed, yaw, camera trigger,
   * jump, etc.) that the flight controller executes in-place; on the wire they
   * become their own mission items sequenced immediately after the parent NAV
   * item. Absent or empty when the waypoint carries no attached actions.
   */
  actions?: MissionAction[];
}

/**
 * Navigation commands — each owns a physical waypoint (a real position the
 * vehicle flies to / through) and starts a `Waypoint` when collapsed from the
 * wire. Exactly one NAV item per `Waypoint`.
 */
export type NavCommand =
  | "WAYPOINT" | "SPLINE_WAYPOINT" | "LOITER" | "LOITER_TIME" | "LOITER_TURNS"
  | "TAKEOFF" | "LAND" | "RTL" | "NAV_PAYLOAD_PLACE" | "VTOL_TAKEOFF"
  | "VTOL_LAND" | "DO_LAND_START";

/**
 * Action commands — non-navigation commands the flight controller executes at
 * or between waypoints. They attach to the preceding NAV waypoint as a
 * `MissionAction` and become their own sequenced mission items on the wire.
 */
export type ActionCommand =
  | "ROI" | "DO_SET_SPEED" | "DO_SET_CAM_TRIGG" | "DO_DIGICAM" | "DO_JUMP"
  | "DELAY" | "CONDITION_YAW" | "DO_SET_SERVO" | "DO_FENCE_ENABLE"
  | "DO_MOUNT_CONTROL" | "DO_GRIPPER" | "DO_WINCH" | "CONDITION_DISTANCE"
  | "DO_SET_HOME" | "DO_AUX_FUNCTION" | "DO_SET_ROI_NONE";

/** MAVLink command types supported in mission waypoints. */
export type WaypointCommand = NavCommand | ActionCommand;

/**
 * A known non-navigation command attached to a `Waypoint`. On the wire it
 * expands to its own `MissionItem` sequenced right after the parent NAV item.
 *
 * `lat`/`lon`/`alt` are only meaningful for the position-bearing action commands
 * (`ROI`, `DO_SET_HOME`) and are written to the item's x/y/z. Every other
 * action carries its fifth to seventh MAVLink parameters in `param5`..`param7`
 * (the same x/y/z wire slots, unscaled), e.g. DO_DIGICAM's shoot command.
 * `jumpTargetId` is only meaningful for `DO_JUMP`: it references the `id` of the
 * NAV `Waypoint` to jump to (resolved to a flattened `seq` at encode time),
 * decoupling the jump target from raw sequence indices that shift as the mission
 * is edited.
 */
export interface CommandMissionAction {
  id: string;
  command: ActionCommand;
  param1?: number;
  param2?: number;
  param3?: number;
  param4?: number;
  /** MAVLink param5 (item x) for a non-positional action. */
  param5?: number;
  /** MAVLink param6 (item y) for a non-positional action. */
  param6?: number;
  /** MAVLink param7 (item z) for a non-positional action. */
  param7?: number;
  /** Latitude in degrees. Only for position-bearing actions (ROI / DO_SET_HOME). */
  lat?: number;
  /** Longitude in degrees. Only for position-bearing actions (ROI / DO_SET_HOME). */
  lon?: number;
  /** Altitude in meters. Only for position-bearing actions (ROI / DO_SET_HOME). */
  alt?: number;
  /** For DO_JUMP: the `id` of the NAV waypoint to jump to. */
  jumpTargetId?: string;
}

/**
 * A mission item whose command this GCS does not model, carried verbatim so a
 * download → upload round trip re-emits it byte-for-byte. It rides the NAV
 * waypoint it followed on the wire and is shown read-only in the planner.
 */
export interface RawMissionAction {
  id: string;
  command: "RAW";
  /** The MAV_CMD id exactly as received. */
  rawCommand: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  /** Wire x (int32) exactly as received. */
  x: number;
  /** Wire y (int32) exactly as received. */
  y: number;
  /** Wire z exactly as received. */
  z: number;
  /** MAV_FRAME exactly as received. */
  frame: number;
}

/** An action attached to a navigation waypoint: a modelled command or a raw passthrough. */
export type MissionAction = CommandMissionAction | RawMissionAction;

/** Available tools in the map toolbar. */
export type PlannerTool =
  | "select" | "waypoint" | "polygon" | "circle" | "measure"
  | "takeoff" | "land" | "loiter" | "roi" | "rally" | "datum" | "poi";

/** Altitude reference frame for waypoints. */
export type AltitudeFrame = "relative" | "absolute" | "terrain";

export type MissionState = "idle" | "planning" | "uploading" | "uploaded" | "running" | "paused" | "completed" | "aborted";

export interface Mission {
  id: string;
  name: string;
  droneId: string;
  templateName?: string;
  waypoints: Waypoint[];
  state: MissionState;
  progress: number;      // 0-100
  currentWaypoint: number;
  estimatedTime?: number; // seconds
  estimatedDistance?: number; // meters
  startedAt?: number;
  completedAt?: number;
}

// ── Video ────────────────────────────────────────────────────

export interface VideoState {
  streamUrl: string | null;
  isStreaming: boolean;
  isRecording: boolean;
  fps: number;
  latencyMs: number;
  resolution?: string;
}

// ── Input ────────────────────────────────────────────────────

export type InputController = "keyboard" | "gamepad" | "rc_tx" | "none";

export interface InputState {
  activeController: InputController;
  axes: [number, number, number, number]; // roll, pitch, throttle, yaw (-1 to 1)
  buttons: boolean[];
  deadzone: number;
  expo: number;
}

// ── Plan Library ────────────────────────────────────────────

export interface SavedPlan {
  id: string;
  name: string;
  folderId: string | null;
  waypoints: Waypoint[];
  metadata: PlanMetadata;
  /**
   * Full geofence geometry saved with the plan. Absent when the plan has no
   * fence. Restored into the geofence store when the plan loads so a saved plan
   * round-trips its inclusion/exclusion zones, alt bands, and breach action.
   */
  geofence?: GeofenceSnapshot;
  /** Rally points saved with the plan. Absent when the plan has none. */
  rally?: RallyPoint[];
  /**
   * Plan-attached points of interest (GCS annotations, not an FC concept).
   * Absent when the plan has none.
   */
  pois?: PointOfInterest[];
  createdAt: number;
  updatedAt: number;
}

export interface PlanMetadata {
  droneId?: string;
  geofence?: { enabled: boolean; type: string; maxAlt: number; action: string };
  totalDistance?: number;
  estimatedTime?: number;
}

export interface PlanFolder {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: number;
  order: number;
}

export interface SimHistoryEntry {
  id: string;
  planId: string;
  planName: string;
  timestamp: number;
  duration: number;
  waypointCount: number;
}
