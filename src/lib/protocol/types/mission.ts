/**
 * Mission and log-related protocol types.
 *
 * @module protocol/types/mission
 */

/** On-board log entry received from LOG_ENTRY (msg 118). */
export interface LogEntry {
  id: number;
  numLogs: number;
  lastLogId: number;
  size: number;
  /** Seconds since 1970 UTC, or 0 if unavailable. */
  timeUtc: number;
}

/** Progress callback for log data download. */
export type LogDownloadProgressCallback = (receivedBytes: number, totalBytes: number) => void;

/** Progress callback for FTP file download. totalBytes is 0 when the size is unknown. */
export type FtpDownloadProgressCallback = (receivedBytes: number, totalBytes: number) => void;

/** Progress callback for a mission upload: items sent so far out of the total. */
export type MissionUploadProgressCallback = (sentItems: number, totalItems: number) => void;

/** Fence zone role: inclusion = stay inside, exclusion = stay outside. */
export type FenceRole = "inclusion" | "exclusion";

/**
 * Firmware-agnostic geofence element the GCS edits.
 *
 * The geofence is stored as a mission plan (mission_type = fence), so a
 * polygon or circle maps to NAV_FENCE_* mission items and the fence return
 * point to NAV_FENCE_RETURN_POINT.
 */
export type FenceElement =
  | FenceZoneElement
  | {
      /** NAV_FENCE_RETURN_POINT: where the vehicle flies after a breach (ArduPlane). */
      kind: "returnPoint";
      lat: number;
      lon: number;
    };

/** A fence element that bounds an area: a polygon or a circle. */
export type FenceZoneElement =
  | {
      kind: "polygon";
      role: FenceRole;
      vertices: Array<{ lat: number; lon: number }>;
      /** Inclusion group (inclusion polygons only); ignored for exclusion. */
      group?: number;
    }
  | {
      kind: "circle";
      role: FenceRole;
      center: { lat: number; lon: number };
      /** Radius in meters. */
      radius: number;
      /** Inclusion group (inclusion circles only); ignored for exclusion. */
      group?: number;
    };

/**
 * One rally point as it travels in a rally-type mission. `frame` is the
 * MAV_FRAME the altitude is measured in: 6 (relative to home) or 10 (above
 * terrain) on upload; whatever the vehicle stored on download (0 = AMSL).
 */
export interface RallyPointItem {
  lat: number;
  lon: number;
  alt: number;
  frame: number;
}

/** Wire-format mission item for upload/download (INT variant). */
export interface MissionItem {
  seq: number;
  /** MAV_FRAME enum. */
  frame: number;
  /** MAV_CMD enum. */
  command: number;
  current: number;
  autocontinue: number;
  param1: number;
  param2: number;
  param3: number;
  param4: number;
  /** Latitude * 1e7. */
  x: number;
  /** Longitude * 1e7. */
  y: number;
  /** Altitude in meters. */
  z: number;
}
