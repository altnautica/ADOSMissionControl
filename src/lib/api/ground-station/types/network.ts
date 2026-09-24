/**
 * @module api/ground-station/types/network
 * @description Network and uplink types: WiFi access point, WiFi client,
 * Ethernet, cellular modem, uplink priority + share + failover events.
 *
 * @license GPL-3.0-only
 */

export interface ApStatus {
  /** Null when the agent could not ask systemd; unknown, never "off". */
  enabled: boolean | null;
  /** Whether the AP service is up; null when systemd did not answer. */
  running?: boolean | null;
  ssid: string;
  passphrase: string;
  channel: number;
  connected_clients?: number | null;
  /** Set by the AP write route: whether the SSID/channel also reached the
   * node's config, so they survive a restart. Absent on reads. */
  persisted?: boolean;
  persist_error?: string;
}

export interface WifiClientStatus {
  available: boolean;
  connected?: boolean;
  ssid?: string | null;
  bssid?: string | null;
  rssi_dbm?: number | null;
  signal?: number | null;
  security?: string | null;
  ip?: string | null;
  gateway?: string | null;
}

export interface EthernetStatus {
  available: boolean;
  link?: boolean;
  speed_mbps?: number | null;
  ip?: string | null;
  gateway?: string | null;
  iface?: string | null;
}

// Ethernet static-IP config (backend pending)
export interface EthernetConfig {
  mode: "dhcp" | "static";
  ip?: string;       // IPv4 with prefix, e.g., "192.168.1.42/24"
  gateway?: string;
  dns?: string[];    // IPv4 addresses
}

export type EthernetConfigUpdate = Partial<EthernetConfig>;

export type DataCapState = "ok" | "warn_80" | "throttle_95" | "blocked_100";

export interface ModemUpdate {
  apn?: string;
  cap_gb?: number;
  enabled?: boolean;
}

/**
 * The modem view the agent's network/modem read AND write routes serve, and
 * the `modem_4g` leg of the network snapshot (ados-control `gs_network.rs`
 * modem_body): config legs (`enabled`, `apn`, `cap_mb`), cumulative usage
 * (`data_used_mb`, `percent`) from the data-cap tracker, and connectivity legs
 * (`connected`, `iface`, `ip`, `signal_quality`, `technology`, `operator`,
 * `state`) that are null whenever nothing has probed them. A null is "not
 * reported", never a reading. Whether a modem is present at all is the
 * separate `ModemDetailStatus`.
 */
export interface ModemView {
  enabled: boolean;
  apn: string | null;
  cap_mb: number | null;
  connected: boolean | null;
  iface: string | null;
  ip: string | null;
  signal_quality: number | null;
  technology: string | null;
  operator: string | null;
  state: string | null;
  data_used_mb: number | null;
  percent: number | null;
}

/** The cellular detail snapshot (`GET .../modem-status`): whether a modem is
 * present at all, with the agent's reason when it is not. */
export interface ModemDetailStatus {
  /** `null` when the agent did not probe for a modem (`reason: "not_probed"`). */
  present: boolean | null;
  reason?: string | null;
  [key: string]: unknown;
}

export type UplinkHealth = "ok" | "degraded" | "down";

export interface NetworkStatus {
  ap: ApStatus;
  wifi_client: WifiClientStatus;
  ethernet?: EthernetStatus;
  modem_4g?: ModemView;
  // legacy field
  modem?: ModemView;
  active_uplink?: string | null;
  priority?: string[];
  share_uplink?: boolean;
}

export interface ApUpdate {
  enabled?: boolean;
  ssid?: string;
  passphrase?: string;
  channel?: number;
}

export interface WifiScanResult {
  ssid: string;
  bssid: string;
  signal: number;
  security: string;
  in_use?: boolean;
}

export interface WifiScanResponse {
  networks: WifiScanResult[];
}

export interface WifiJoinResult {
  joined: boolean;
  ssid: string;
  needs_force?: boolean;
}

export interface WifiLeaveResult {
  previous_ssid: string | null;
}

export interface UplinkPriorityConfig {
  priority: string[];
}

export interface ShareUplinkResult {
  enabled: boolean;
  /** Whether the firewall/NAT rule was actually applied to a live uplink.
   *  False when the flag was persisted but no active uplink resolved (or the
   *  firewall helper failed); `apply_error` then carries the short reason. */
  applied?: boolean;
  /** Short reason the apply did not take effect (no active uplink, helper
   *  failure, etc.). Present only when `applied` is false. */
  apply_error?: string | null;
  /** Firewall backend that handled the rule (iptables-persistent, nftables). */
  backend?: string | null;
}

export interface UplinkFailoverEntry {
  from: string | null;
  to: string;
  reason: string;
  timestamp: number;
}

/** The one frame `/ws/uplink` emits (ados-control `gs_ws.rs`
 * uplink_ws_payload), sent whenever the uplink snapshot changes. */
export interface UplinkEvent {
  kind: "health_changed";
  active_uplink: string | null;
  available: string[];
  internet_reachable: boolean;
  data_cap_state: DataCapState | null;
  timestamp_ms: number | null;
}
