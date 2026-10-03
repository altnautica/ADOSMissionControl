/**
 * @module agent/agent-client/types
 * @description Response shapes for endpoints whose return types are
 * declared at the client surface (no separate canonical type module).
 * Re-exported through the legacy `@/lib/agent/client` barrel.
 * @license GPL-3.0-only
 */

export interface SigningCapability {
  supported: boolean;
  reason:
    | "ok"
    | "fc_not_connected"
    | "firmware_not_supported"
    | "firmware_px4_no_persistent_store"
    | "msp_protocol"
    | string;
  firmware_name: string | null;
  firmware_version: string | null;
  signing_params_present: boolean;
}

/** `POST /api/mavlink/signing/enroll-fc`. ArduPilot never acknowledges
 * SETUP_SIGNING, so after sending the agent watches the FC for a few seconds:
 * `verified` is true only when a frame from the FC arrived signed with the new
 * key. `sent: true, verified: false` means the key went out but the FC was
 * not seen using it. */
export interface SigningEnrollResult {
  sent: boolean;
  verified: boolean;
  key_id: string;
  enrolled_at: string;
}

/** `POST /api/mavlink/signing/disable-on-fc`. `verified` is true only when an
 * unsigned frame from the FC arrived after the empty key was sent. */
export interface SigningDisableResult {
  sent: boolean;
  verified: boolean;
}

/** `GET /api/mavlink/signing/counters`. An agent with no signed-frame observer
 * reports `observed: false` with every count null: the counts were not
 * measured, which is not the same as zero. An agent that predates the flag
 * sends no `observed` key and hard-coded zeros, so only `observed === true`
 * makes the counts meaningful. */
export interface SigningCounters {
  observed: boolean;
  tx_signed_count: number | null;
  rx_signed_count: number | null;
  /** Unix seconds of the last signed frame received from the FC. */
  last_signed_rx_at: number | null;
}

/** One entry of `GET /api/video/cameras`. The agent sends `device_path`,
 * `type`, `label`, `width` and `height`; `name`, `hardware_role` and
 * `resolution` are carried only by the demo roster. */
export interface CameraEntry {
  device_path: string;
  type: string;
  /** Friendly label for the camera. */
  label?: string | null;
  width?: number | null;
  height?: number | null;
  name?: string;
  hardware_role?: string;
  resolution?: string | null;
}

export interface CameraListResponse {
  cameras: CameraEntry[];
  /** Role -> device path bindings. Keys are typically "primary" and
   * "secondary"; values are device paths or null when unbound. */
  assignments: Record<string, string | null | unknown>;
}

/** A ground-station recorder start / stop reply. Start carries
 * `{filename, started_at, path}`; stop carries `{filename, stopped_at,
 * duration_seconds, size_bytes}`. A refusal is a non-2xx (409 / 503 / 507)
 * that the client throws, never a 2xx body. */
export interface RecordingControlResponse {
  filename?: string;
  path?: string;
  started_at?: string | number;
  stopped_at?: string | number;
  duration_seconds?: number;
  size_bytes?: number;
}

export interface RecordingFileEntry {
  filename: string;
  size_bytes: number;
  mtime: number;
  duration_sec?: number | null;
  started_at?: number | null;
}

export interface RecordingListResponse {
  recording: boolean;
  current_filename: string | null;
  items: RecordingFileEntry[];
}
