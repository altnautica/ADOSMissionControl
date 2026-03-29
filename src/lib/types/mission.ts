/**
 * Mission planning, suite, video, and input types.
 * @module types/mission
 */

export type SuiteType = "sentry" | "survey" | "agriculture" | "cargo" | "sar" | "inspection";

export interface Waypoint {
  id: string;
  lat: number;
  lon: number;
  alt: number;         // meters AGL
  speed?: number;      // m/s
  holdTime?: number;   // seconds
  command?: WaypointCommand;
  param1?: number;
  param2?: number;
  param3?: number;
  groundElevation?: number;  // terrain elevation MSL at this waypoint
}

/** MAVLink command types supported in mission waypoints. */
export type WaypointCommand =
  | "WAYPOINT" | "SPLINE_WAYPOINT" | "LOITER" | "LOITER_TIME" | "LOITER_TURNS"
  | "TAKEOFF" | "LAND" | "RTL" | "ROI" | "DO_SET_SPEED"
  | "DO_SET_CAM_TRIGG" | "DO_DIGICAM" | "DO_JUMP" | "DELAY" | "CONDITION_YAW"
  | "DO_SET_SERVO" | "DO_FENCE_ENABLE" | "DO_MOUNT_CONTROL" | "DO_GRIPPER"
  | "DO_WINCH" | "NAV_PAYLOAD_PLACE" | "CONDITION_DISTANCE" | "DO_SET_HOME"
  | "DO_AUX_FUNCTION" | "VTOL_TAKEOFF" | "VTOL_LAND" | "DO_SET_ROI_NONE"
  | "DO_LAND_START";

/** Available tools in the map toolbar. */
export type PlannerTool =
  | "select" | "waypoint" | "polygon" | "circle" | "measure"
  | "takeoff" | "land" | "loiter" | "roi" | "rally";

/** Altitude reference frame for waypoints. */
export type AltitudeFrame = "relative" | "absolute" | "terrain";

export type MissionState = "idle" | "planning" | "uploading" | "uploaded" | "running" | "paused" | "completed" | "aborted";

export interface Mission {
  id: string;
  name: string;
  droneId: string;
  suiteType?: SuiteType;
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
  createdAt: number;
  updatedAt: number;
  syncStatus: "local" | "synced" | "syncing" | "conflict";
  cloudId?: string;
}

export interface PlanMetadata {
  droneId?: string;
  suiteType?: SuiteType;
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
  completedFully: boolean;
}
