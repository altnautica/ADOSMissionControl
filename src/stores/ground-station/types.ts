/**
 * Shared types for the ground-station store slices. Lifted out of the main
 * store file so consumers have a single import home for slice shapes.
 *
 * @module stores/ground-station/types
 */

import type {
  ApStatus,
  BluetoothDevice,
  DisplayConfig,
  EthernetConfig,
  Gamepad,
  MeshGateway,
  MeshHealth,
  MeshNeighbor,
  MeshRoute,
  NetworkStatus,
  PairingPendingRequest,
  PairResult,
  PeripheralDetail,
  PeripheralSummary,
  RoleInfo,
  UiConfig,
  UplinkFailoverEntry,
  UplinkHealth,
  WfbReceiverCombined,
  WfbReceiverRelay,
  WfbRelayStatus,
  WifiScanResult,
} from "@/lib/api/ground-station-api";

export interface GroundStationLinkHealth {
  rssi_dbm: number | null;
  bitrate_mbps: number | null;
  fec_rec: number;
  fec_lost: number;
  channel: number | null;
}

export type WfbBitrateProfile = "low-latency" | "balanced" | "long-range";

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

export interface PairSlice {
  loading: boolean;
  result: PairResult | null;
  error: string | null;
  errorStatus: number | null;
}

export interface PicSlice {
  state: string;
  claimed_by: string | null;
  claim_counter: number;
  primary_gamepad_id: string | null;
  loading: boolean;
  error: string | null;
}

export interface GamepadsSlice {
  devices: Gamepad[];
  primary_id: string | null;
  loading: boolean;
}

export interface BluetoothSlice {
  scanning: boolean;
  scan_results: BluetoothDevice[];
  paired: BluetoothDevice[];
  pairing_mac: string | null;
  error: string | null;
}

export interface WifiScanCache {
  results: WifiScanResult[];
  scanning: boolean;
  scannedAt: number | null;
  error: string | null;
}

export interface UplinkDataCap {
  state: "ok" | "warn_80" | "throttle_95" | "blocked_100";
  percent: number;
  used_mb: number;
  cap_mb: number;
}

/**
 * Cloud-relay forwarding state for a ground station reached over the cloud.
 * Populated from the cloud status heartbeat (the uplink-aware relay bridge);
 * null when the ground station is reached locally or is not relaying.
 */
export interface UplinkCloudRelay {
  mqtt_connected: boolean;
  throttle_state: string;
  forwarding_video: boolean;
  forwarding_telemetry: boolean;
}

export interface UplinkSlice {
  active: string | null;
  priority: string[];
  /** Null until the node has reported a health verdict. */
  health: UplinkHealth | null;
  failover_log: UplinkFailoverEntry[];
  data_cap: UplinkDataCap | null;
  cloud_relay: UplinkCloudRelay | null;
  /**
   * Result of the last share-uplink toggle. `null` until a toggle is made;
   * `true` when the firewall/NAT rule took effect, `false` when the flag was
   * persisted but no active uplink resolved (the reason is in
   * `shareUplinkAppliedReason`).
   */
  shareUplinkApplied: boolean | null;
  /** Short reason the last share-uplink toggle did not apply. Null on success. */
  shareUplinkAppliedReason: string | null;
  loading: boolean;
  error: string | null;
  /** Epoch ms the uplink slice was last refreshed from the node (LAN network
   * read, uplink event, or cloud heartbeat). Null until the first reading. */
  fetchedAt: number | null;
}

export interface PeripheralsSlice {
  list: PeripheralSummary[];
  detail: Record<string, PeripheralDetail>;
  loading: boolean;
  error: string | null;
}

// Distributed receive + mesh slices.

export interface RoleSlice {
  info: RoleInfo | null;
  loading: boolean;
  switching: boolean;
  error: string | null;
  /** Epoch ms `info` was last read from the node. Null until the first read. */
  fetchedAt: number | null;
}

export interface DistributedRxSlice {
  /** Receiver view of remote relays; empty on relay/direct nodes, null when
   * the receiver's snapshot is stale (no current reading of the relay set). */
  receiverRelays: WfbReceiverRelay[] | null;
  /** Receiver combined FEC output; null on relay/direct nodes. */
  combined: WfbReceiverCombined | null;
  /** Relay view of its local forwarder state; null on receiver/direct nodes. */
  relayStatus: WfbRelayStatus | null;
  pairingWindowOpen: boolean;
  pairingWindowExpiresAt: number | null;
  pendingRequests: PairingPendingRequest[];
  loading: boolean;
  error: string | null;
}

export interface MeshTransientEvent {
  kind: string;
  payload: Record<string, unknown>;
  ts: number;
}

export type MeshWsState = "idle" | "connected" | "reconnecting" | "closed";

export interface MeshSlice {
  health: MeshHealth | null;
  neighbors: MeshNeighbor[];
  routes: MeshRoute[];
  gateways: MeshGateway[];
  selectedGateway: string | null;
  /** Latest transient (toast-worthy) event the WS surfaced. */
  lastTransientEvent: MeshTransientEvent | null;
  /** Live mesh WS connection state so the UI can surface a
   * "connection lost / reconnecting" banner instead of silently
   * missing neighbor / gateway / pair events. */
  wsState: MeshWsState;
  /** Epoch ms the ws last left the connected state. Null while connected
   * or while we have never connected. */
  wsDisconnectedAt: number | null;
  loading: boolean;
  error: string | null;
  /** Epoch ms the mesh state was last read from the node. Null until the
   * first read. */
  fetchedAt: number | null;
}
