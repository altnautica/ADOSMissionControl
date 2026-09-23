/**
 * @module api/ground-station/types/status
 * @description Top-level status response shape returned by the ground agent.
 *
 * @license GPL-3.0-only
 */

export interface GroundStationLinkHealth {
  rssi_dbm: number | null;
  bitrate_mbps: number | null;
  fec_rec: number;
  fec_lost: number;
  channel: number | null;
}

export type GroundStationProfile =
  | "ground_station"
  | "drone"
  | "auto"
  | "unconfigured";

export interface GroundStationStatus {
  paired_drone: string | null;
  profile: GroundStationProfile;
  uplink_active: string | null;
}

export interface GroundStationStatusResponse extends GroundStationStatus {
  link_health?: Partial<GroundStationLinkHealth>;
}

export type WfbBitrateProfile = "low-latency" | "balanced" | "long-range";

/** WFB link configuration as the ground agent's /wfb route reads and writes it. */
export interface WfbConfig {
  channel: number;
  bitrate_profile: WfbBitrateProfile;
  /** Optional regulatory/transmit-power request, in dBm. Caller-supplied;
   *  the agent clamps to the per-driver maximum and reports back the
   *  effective value via the radio status block. */
  tx_power_dbm?: number;
  /** Optional MCS index for the radio link; agent rejects unsupported
   *  values per the active driver. */
  mcs_index?: number;
}
