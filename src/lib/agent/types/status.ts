/**
 * @module AgentTypes
 * @description Agent REST status, board, service and peripheral types.
 * @license GPL-3.0-only
 */

import type { RadioFleetApply } from "@/lib/hud/status-pill";

/** Agent /api/version response. Capability flags are stable string keys
 * the GCS uses to gate features; an older agent simply omits the flag. */
export interface AgentVersionInfo {
  api_version: string;
  agent_version: string;
  capabilities: string[];
}

export interface BoardInfo {
  name: string;
  model: string;
  /** HAL profile stem (`rock-5c-lite`). Absent on agents that predate it. */
  profile?: string;
  /** Absent on a node with no board sidecar (compute/workstation, or any
   *  board the HAL did not match). Never substitute 0 — a tier-0 board with
   *  0 MB of RAM and 0 cores is a fabricated hardware fact. */
  tier?: number;
  ram_mb?: number;
  cpu_cores?: number;
  vendor: string;
  soc: string;
  arch: string;
  hw_video_codecs: string[];
}

/**
 * Resource utilisation the agent reported on its last heartbeat.
 *
 * The three percentages are optional because an agent that omits the resource
 * block has told us nothing about its load. Absence is NOT zero utilisation, so
 * every field is left undefined rather than coerced, and a surface renders it
 * as unknown. `temperature` already carried this discipline as `number | null`.
 */
export interface HealthInfo {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  temperature: number | null;
  timestamp: string;
}

/**
 * Source of the WFB radio kernel module on this board.
 *  - `prebuilt`: a shipped binary module matched the running kernel
 *  - `dkms`: the module was built on-device against the running kernel
 *  - `none`: no radio module is present
 */
export type WfbModuleSource = "prebuilt" | "dkms" | "none";

/**
 * Install-health summary from the agent's self-check at last boot.
 *  - `ok`: every install step passed
 *  - `degraded`: the agent runs but one or more steps did not complete
 *  - `failed`: the install did not complete; the agent may be impaired
 *  - `unknown`: the agent did not report a status (older agents)
 */
export type InstallStatus = "ok" | "degraded" | "failed" | "unknown";

/**
 * Which transport the MAVLink router uses to reach the flight controller.
 *  - `auto`: the router probes the available ports and picks one
 *  - `serial`: a fixed serial device (`serial_port` @ `baud_rate`)
 *  - `udp`: a UDP endpoint
 *  - `tcp`: a TCP endpoint
 */
export type FcSource = "auto" | "serial" | "udp" | "tcp";

/** One enumerable serial device the agent's router can bind as the FC link. */
export interface MavlinkPort {
  /** Device path (e.g. `/dev/ttyACM0`). */
  path: string;
  /** Human-readable description from the OS (e.g. `Pixhawk · ArduPilot`). */
  description: string;
}

/** Response from `GET /api/mavlink/ports`. */
export interface MavlinkPortsResponse {
  ports: MavlinkPort[];
}

/** Response from `GET /api/ping` — a server-stamped echo for control-plane RTT. */
export interface PingResponse {
  /** Server epoch milliseconds at the moment the agent answered. */
  pong: number;
}

export interface AgentStatus {
  version: string;
  /** Agent process uptime. Absent when the producer did not carry it. */
  uptime_seconds?: number;
  board: BoardInfo;
  health: HealthInfo;
  /** Gated FC truth: `transport_open && mavlink_alive`. Older agents set this
   * to "transport open" only, so the GCS prefers the explicit `mavlink_alive`
   * + `heartbeat_age_s` fields below when present. */
  fc_connected: boolean;
  fc_port: string;
  fc_baud: number;
  /** True when the MAVLink transport (serial / udp / tcp) is open, regardless
   * of whether a HEARTBEAT has been decoded. With this true but
   * `mavlink_alive` false the agent has a port open but no live link. Absent
   * on agents that predate the gated truth surface. */
  transport_open?: boolean;
  /** True when a HEARTBEAT was decoded within the agent's freshness window.
   * This is the real "FC is talking to us" signal. Absent on older agents. */
  mavlink_alive?: boolean;
  /** Seconds since the last decoded HEARTBEAT, or null when none has been
   * seen. Absent on older agents. */
  heartbeat_age_s?: number | null;
  /** Which FC source the router resolved the link from. Absent on older
   * agents (no source picker). */
  fc_source?: FcSource;
  /** Diagnostic hint for why the link is not alive, so the GCS can render an
   * actionable remediation message. One of `"none"` | `"msp_detected"`
   * (an FC is on the port but speaking MSP, not MAVLink) | `"no_heartbeat"`
   * (a port is open but no HEARTBEAT decoded). Absent on older agents. */
  fc_link_hint?: string;
  /** Which protocol family the agent identified on the FC serial link:
   * `"betaflight"` | `"inav"` once an MSP FC is recognised. Drives the GCS's
   * choice of protocol adapter (MSP for these, MAVLink otherwise). Absent on
   * ArduPilot / PX4 / an unidentified FC / older agents. */
  fc_variant?: string;
  /** Canonical FC firmware family the agent identified: `"ardupilot"` |
   * `"px4"` | `"betaflight"` | `"inav"` | `"unknown"`. Unlike `fc_variant`
   * this distinguishes the two MAVLink stacks (ArduPilot vs PX4) so the fleet /
   * node surfaces can name them. Absent on older agents. */
  fc_firmware?: string;
  /** True when the FC link reads connected but GCS commands to the FC are
   * dropped: a telemetry-only source such as MAVLink over ExpressLRS. Absent
   * on older agents. */
  fc_command_down_gated?: boolean;
  /** A fleet slot delivered to the drone and the radio restart it is owed
   * (LAN `radioFleetApply`, cloud `radio.fleetApply`); null when none was
   * written, absent on older agents. */
  radio_fleet_apply?: RadioFleetApply | null;
  /** Running kernel release (uname -r). Absent on older agents. */
  kernel_release?: string;
  /** How the WFB radio kernel module was provided on this board. */
  wfb_module_source?: WfbModuleSource;
  /** Install-health summary from the agent's last self-check. */
  install_status?: InstallStatus;
  /** Agent install/build version recorded by the installer. */
  install_version?: string;
  /** Install steps that failed or degraded. Empty when healthy. */
  failed_steps?: string[];
}

export interface ServiceInfo {
  name: string;
  status: "running" | "stopped" | "error" | "degraded" | "starting" | "circuit_open";
  pid: number | null;
  /** Per-service metrics are null when the agent did not report them. */
  cpu_percent: number | null;
  memory_mb: number | null;
  uptime_seconds: number | null;
  category?: "core" | "hardware" | "suite" | "ondemand";
}

/**
 * A single service whose config file failed to parse on the agent. The agent
 * kept running on built-in defaults for that service, so the value is a fault
 * to surface, not a crash. Top-level on the system state (not per-service).
 */
export interface ConfigError {
  /** The service whose config load failed (e.g. "ados-video"). */
  service: string;
  /** The parse error message reported by the agent's config loader. */
  error: string;
}

/**
 * The full resource sample from the agent's system endpoint.
 *
 * The utilisation and capacity fields are optional for the same reason as
 * {@link HealthInfo}: a node that reports no resource block is unknown, not
 * idle and not empty. Rendering `0` for an absent reading is indistinguishable
 * from a genuinely idle CPU or a genuinely full disk, so producers preserve the
 * absence and consumers render a placeholder.
 */
export interface SystemResources {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used_mb?: number;
  memory_total_mb?: number;
  /** RAM available for new allocations without swapping (MemAvailable),
   * not just free. Absent when the node did not report it. */
  memory_available_mb?: number;
  /** RAM held by the page cache + reclaimable buffers. Absent when not
   * reported. */
  memory_cache_mb?: number;
  /** Total swap space configured. 0 when no swap is present; absent when not
   * reported. */
  swap_total_mb?: number;
  /** Swap currently in use. */
  swap_used_mb?: number;
  /** Swap utilisation as a percentage of swap_total_mb. */
  swap_percent?: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  temperature: number | null;
}

export interface LogEntry {
  timestamp: string;
  level: "debug" | "info" | "warning" | "error";
  service: string;
  message: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export type PeripheralCategory =
  | "sensor"
  | "camera"
  | "video"
  | "gimbal"
  | "compute"
  | "display";

export interface PeripheralInfo {
  name: string;
  type: string;
  category: PeripheralCategory;
  bus: string;
  address: string;
  rate_hz: number;
  status: "ok" | "warning" | "error" | "offline";
  last_reading: string;
  /** Free-form per-peripheral metadata that is too sparse or
   * volatile to deserve a typed field. Inferers cherry-pick keys
   * they understand (e.g. controller / has_touch / resolution /
   * rotation for displays) and ignore the rest. */
  extra?: Record<string, unknown>;
}

export interface NetworkPeer {
  id: string;
  name: string;
  /** Absent when the peer did not report a measurement. Rendering 0 here
   *  turns "unreported" into a 0 dBm perfect link and a 0% dead battery. */
  signal_dbm?: number;
  last_seen: string;
  battery_percent?: number;
  distance_m?: number;
  tier?: number;
  link_type: string;
}
