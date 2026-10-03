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

/** The ground station's WFB view (`GET /api/v1/ground-station/wfb`). Each
 *  value comes from the live radio sidecar and is null when the radio has not
 *  reported it, never a placeholder 0. */
export interface WfbConfig {
  channel: number | null;
  tx_power_dbm: number | null;
}
