/**
 * @module api/agent/sensors-types
 * @description Wire shapes of the agent's rig-sensor, clock and capture-storage
 * routes (`GET /api/v1/sensors`, `/api/v1/clock`, `/api/v1/storage`,
 * `PUT /api/v1/sensors/rig`). Every route answers 200; a node without the
 * backing service reports `present: false` with the other fields empty.
 * @license GPL-3.0-only
 */

/** The timebase the node's next capture session would record on. */
export type ClockTimebase = "gnss" | "hub_freerun" | "host_monotonic" | "sim";

export interface ClockSource {
  id: string;
  kind: string;
  locked: boolean;
  offset_ns: number;
  skew_ppm: number;
  /** Residual RMS of the source fit; -1 = unmeasured. */
  sigma_ns: number;
  last_update_ns: number;
}

export interface ClockStatus {
  present: boolean;
  timebase: ClockTimebase | null;
  locked: boolean;
  /** -1 = unmeasured. */
  sigma_ns: number;
  t_ns: number;
  utc_ns: number | null;
  sources: ClockSource[];
}

export type RigSensorKind = "camera" | "imu" | "lidar" | "gnss" | "thermal" | "baro" | "mag";
export type RigSensorSource = "hub" | "fc" | "vision" | "gnss" | "lidar" | "sim";

export interface RigSensor {
  id: string;
  kind: RigSensorKind;
  role: string;
  source: RigSensorSource;
  rate_hz: number;
  /** Null when the expected rate is unknown: the UI then draws no rate
   * verdict. */
  expected_hz: number | null;
  last_t_ns: number;
  /** Milliseconds since the last sample; null before the first one. */
  age_ms: number | null;
  /** -1 = unmeasured. */
  sigma_ns: number;
}

export interface SensorHubInfo {
  connected: boolean;
  transport: string;
  fw: string;
  board: string;
  proto_ver: number;
  uptime_s: number;
  crc_errors: number;
  dropped: number;
}

export interface SensorFcInfo {
  connected: boolean;
  autopilot: string;
  highres_imu: boolean;
}

export type GnssFix = "none" | "2d" | "3d" | "dgps" | "rtk_float" | "rtk_fixed";
export type RtkState = "none" | "float" | "fixed";

export interface SensorsGnssSummary {
  fix: GnssFix;
  sats: number;
  hdop: number;
  rtk: RtkState;
}

export interface SensorsStatus {
  present: boolean;
  rig_id: string | null;
  calib_version: string | null;
  hub: SensorHubInfo | null;
  fc: SensorFcInfo | null;
  sensors: RigSensor[];
  gnss: SensorsGnssSummary | null;
}

export interface StorageVolume {
  mount: string;
  device: string;
  fs: string;
  total_bytes: number;
  free_bytes: number;
  rotational: boolean;
  is_capture: boolean;
}

export type CaptureStorageState = "ok" | "near_full" | "full";

export interface CaptureStorage {
  used_bytes: number;
  budget_bytes: number;
  budget_pct: number;
  floor_free_bytes: number;
  sessions: number;
  uploaded: number;
  evict_unuploaded: boolean;
  state: CaptureStorageState;
}

export interface StorageStatus {
  present: boolean;
  capture_root: string | null;
  volumes: StorageVolume[];
  capture: CaptureStorage | null;
  write_probe: { mbps: number; measured_at_ns: number } | null;
}

/** `PUT /api/v1/sensors/rig` success body. */
export interface RigWriteResult {
  ok: true;
  rig_id: string;
  calib_version: string;
}

/** One capture session as the Capture extension lists it
 * (`GET /capture/sessions` on its plugin route mount). */
export interface CaptureSessionSummary {
  session_id: string;
  started_at_utc: string;
  duration_s: number;
  size_bytes: number;
  frames: number;
  rooms: string[];
  floors: number[];
  timebase: ClockTimebase;
  anchor_source: string | null;
  uploaded: boolean;
  upload: {
    state: "idle" | "queued" | "uploading" | "committed" | "failed";
    bytes_sent: number;
    bytes_total: number;
    node: string | null;
    error: string | null;
  };
}
