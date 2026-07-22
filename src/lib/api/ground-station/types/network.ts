/**
 * @module api/ground-station/types/network
 * @description Network and uplink types: WiFi access point, WiFi client,
 * Ethernet, cellular modem, uplink priority + share + failover events.
 *
 * @license GPL-3.0-only
 */

export interface ApStatus {
  enabled: boolean;
  ssid: string;
  passphrase: string;
  channel: number;
  connected_clients?: number | null;
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

export type ModemConnState =
  | "disconnected"
  | "searching"
  | "registered"
  | "connected"
  | "error";

export type DataCapState = "ok" | "warn_80" | "throttle_95" | "blocked_100";

export interface ModemDataCap {
  state: DataCapState;
  percent: number;
  used_mb: number;
  cap_mb: number;
}

export interface ModemStatus {
  available: boolean;
  enabled?: boolean;
  state?: ModemConnState;
  carrier?: string | null;
  operator?: string | null;
  apn?: string | null;
  signal_bars?: number | null;
  signal_dbm?: number | null;
  iface?: string | null;
  ip?: string | null;
  data_cap?: ModemDataCap | null;
}

export interface ModemUpdate {
  apn?: string;
  cap_gb?: number;
  enabled?: boolean;
}

/**
 * The modem view the agent's network/modem read AND write routes serve:
 * config legs (`enabled`, `apn`, `cap_mb`) plus cumulative usage
 * (`data_used_mb`, `percent`) plus connectivity legs that report the
 * manager's no-modem defaults (`signal_quality: -1`, `technology:
 * "unknown"`, `operator: ""`) when no live modem is driving them — a
 * consumer must treat those sentinels as unknown, never as facts.
 */
export interface ModemView {
  enabled?: boolean;
  connected?: boolean;
  iface?: string | null;
  ip?: string | null;
  signal_quality?: number | null;
  technology?: string | null;
  apn?: string | null;
  operator?: string | null;
  data_used_mb?: number | null;
  cap_mb?: number | null;
  percent?: number | null;
  state?: string | null;
}

/** The cellular detail snapshot (`GET .../modem-status`): whether a modem is
 * present at all, with the agent's reason when it is not. */
export interface ModemDetailStatus {
  present: boolean;
  reason?: string | null;
  [key: string]: unknown;
}

export type UplinkHealth = "ok" | "degraded" | "down";

export interface NetworkStatus {
  ap: ApStatus;
  wifi_client: WifiClientStatus;
  ethernet?: EthernetStatus;
  modem_4g?: ModemStatus;
  // legacy field
  modem?: ModemStatus;
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

export type UplinkEvent =
  | { type: "active"; iface: string; timestamp?: number }
  | { type: "priority"; priority: string[] }
  | { type: "health"; health: UplinkHealth; iface?: string }
  | { type: "failover"; from: string | null; to: string; reason: string; timestamp?: number }
  | { type: "data_cap"; state: DataCapState; percent: number; used_mb: number; cap_mb: number }
  | { type: "state"; active: string | null; priority: string[]; health: UplinkHealth }
  | { type: string; [key: string]: unknown };
