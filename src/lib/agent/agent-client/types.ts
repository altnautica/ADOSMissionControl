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

export interface SigningEnrollResult {
  success: boolean;
  key_id: string;
  enrolled_at: string;
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

export interface CameraEntry {
  name: string;
  type: string;
  device_path: string;
  hardware_role: string;
  /** Optional resolution string ("1920x1080"). Surfaced when the
   * agent's HAL probe could read it; absent on opaque vendor cameras. */
  resolution?: string | null;
  /** Optional friendly label for the camera; falls back to `name`. */
  label?: string | null;
}

export interface CameraListResponse {
  cameras: CameraEntry[];
  /** Role -> device path bindings. Keys are typically "primary" and
   * "secondary"; values are device paths or null when unbound. */
  assignments: Record<string, string | null | unknown>;
}

export interface RecordingControlResponse {
  path?: string;
  status?: string;
  error?: string;
  recording?: boolean;
  recording_filename?: string | null;
  recording_started_at?: string | null;
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
