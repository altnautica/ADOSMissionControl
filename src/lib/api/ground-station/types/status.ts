/**
 * @module api/ground-station/types/status
 * @description Top-level status response shape returned by the ground agent.
 *
 * @license GPL-3.0-only
 */

import type { PairRearm } from "@/lib/hud/status-pill";

export interface GroundStationLinkHealth {
  rssi_dbm: number | null;
  bitrate_mbps: number | null;
  fec_rec: number;
  fec_lost: number;
  channel: number | null;
}

/** The agent profile the ground-station status route reports, in the agent's
 * underscore spelling. The Visor shares the display/buttons/screens routes. */
export type GroundStationProfile =
  | "ground_station"
  | "visor"
  | "drone"
  | "auto"
  | "unconfigured";

export interface GroundStationStatus {
  paired_drone: string | null;
  profile: GroundStationProfile;
  uplink_active: string | null;
  /** The auto-pair re-arm this ground station's key last took (`link.pair_rearm`
   *  on the agent's `/status`): its cause and whether its bind window runs.
   *  Null when it was never re-armed, or on an agent that does not report it. */
  pair_rearm: PairRearm | null;
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
  /** TX power measured back from the PHY after the last apply; null when
   *  the radio has not measured it. */
  tx_power_readback_dbm: number | null;
}
