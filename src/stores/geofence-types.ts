/** Geofence store types, shared by the store and its consumers. */

export type FenceType = "circle" | "polygon";
export type BreachAction = "RTL" | "LAND" | "REPORT";

/** Fence zone role: inclusion = must stay inside, exclusion = must stay outside */
export type FenceZoneRole = "inclusion" | "exclusion";

export interface FenceZone {
  id: string;
  role: FenceZoneRole;
  type: FenceType;
  /** Polygon points [lat, lon] for polygon zones */
  polygonPoints: [number, number][];
  /** Center for circle zones */
  circleCenter: [number, number] | null;
  /** Radius for circle zones (meters) */
  circleRadius: number;
}

/**
 * Immutable snapshot of the operator-editable geofence state for the
 * coordinated planner undo timeline. Live FENCE_STATUS telemetry (breach
 * fields) and async upload/download state are intentionally excluded — they are
 * driven by the FC, not by operator edits, so undo must not roll them back.
 */
export interface GeofenceSnapshot {
  enabled: boolean;
  fenceType: FenceType;
  maxAltitude: number;
  minAltitude: number;
  breachAction: BreachAction;
  circleCenter: [number, number] | null;
  circleRadius: number;
  polygonPoints: [number, number][];
  zones: FenceZone[];
  /**
   * Radius (m) of ArduPilot's home-centred circle fence, read from
   * FENCE_RADIUS when FENCE_TYPE has the circle bit set. Absent when the
   * vehicle enforces no home circle or it was never read.
   */
  homeCircleRadiusM?: number;
  /** The fence return point (NAV_FENCE_RETURN_POINT) held with the fence, when it has one. */
  returnPoint?: { lat: number; lon: number };
}

/** Outcome of a fence upload or download, carrying the reason on failure so
 *  the calling surface can report it instead of toasting an affirmative. */
export interface FenceTransferResult {
  success: boolean;
  message: string;
  /**
   * On a failed transfer the vehicle refused or never finished: its
   * MAV_MISSION_RESULT, or a negative GCS-side outcome (see
   * `protocol/mission-result`), for the UI to put into words.
   */
  resultCode?: number;
}
