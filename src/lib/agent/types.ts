/**
 * @module AgentTypes
 * @description TypeScript types for the ADOS Drone Agent REST API.
 * @license GPL-3.0-only
 */

/**
 * Agent /api/version response. Capability flags are stable string keys
 * the GCS uses to gate features; an older agent simply omits the flag.
 */
export interface AgentVersionInfo {
  api_version: string;
  agent_version: string;
  capabilities: string[];
}

export interface BoardInfo {
  name: string;
  model: string;
  tier: number;
  ram_mb: number;
  cpu_cores: number;
  vendor: string;
  soc: string;
  arch: string;
  hw_video_codecs: string[];
  /** SoC string the board YAML declares (hand-authored). Kept separate
   * from `soc` so the UI can show declared-vs-probed drift. Undefined on
   * agents that predate the probed-truth surface. */
  soc_declared?: string;
  /** SoC compatible string the kernel actually reports (device-tree
   * compatible, most-specific first). Authoritative over the declared
   * value. Undefined when the boot probe sidecar is absent or the SoC
   * was not probed. */
  soc_probed?: string;
  /** Probed CPU-cluster summary the silicon reports, one entry per
   * big.LITTLE cluster (e.g. "Cortex-A76 x2 + Cortex-A55 x4").
   * Undefined when not probed. */
  cpu_probed?: string;
  /** Confirmed hardware H.264 encoder node, present only after a real
   * trial-init (not an advertised-but-absent wrapper). Undefined when
   * no hardware encoder was probed. */
  hw_encoder_probed?: string;
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
  uptime_seconds: number;
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
  cpu_percent: number;
  memory_mb: number;
  uptime_seconds: number;
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
   * not just free. Defaults to 0 on agents that predate the field. */
  memory_available_mb: number;
  /** RAM held by the page cache + reclaimable buffers. Defaults to 0
   * on agents that predate the field. */
  memory_cache_mb: number;
  /** Total swap space configured. 0 when no swap is present. */
  swap_total_mb: number;
  /** Swap currently in use. */
  swap_used_mb: number;
  /** Swap utilisation as a percentage of swap_total_mb. */
  swap_percent: number;
  disk_percent?: number;
  disk_used_gb?: number;
  disk_total_gb?: number;
  temperature: number | null;
}

export interface TelemetrySnapshot {
  lat: number;
  lon: number;
  alt: number;
  relative_alt: number;
  heading: number;
  groundspeed: number;
  airspeed: number;
  roll: number;
  pitch: number;
  yaw: number;
  battery_voltage: number;
  battery_current: number;
  battery_remaining: number;
  gps_fix: number;
  satellites: number;
  mode: string;
  armed: boolean;
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

export interface MeshNetEnrollment {
  enrolled: boolean;
  droneId?: string;
  fleetName?: string;
  tier?: number;
  enrolledSince?: string;
}

export interface NetworkPeer {
  id: string;
  name: string;
  signal_dbm: number;
  last_seen: string;
  battery_percent: number;
  distance_m: number;
  tier: number;
  link_type: string;
}

// ── Video ──────────────────────────────────────────────

export interface VideoStatus {
  state: "not_initialized" | "stopped" | "starting" | "running" | "error";
  whep_url: string | null;
  encoder: string | null;
  cameras: {
    cameras: Array<{
      name: string;
      type: string;
      device_path: string;
      hardware_role: string;
    }>;
    assignments: Record<string, unknown>;
  };
  mediamtx: { running: boolean; webrtc_port: number };
  dependencies?: Record<string, { found: boolean; path: string | null }>;
}

// ── Setup / onboarding ─────────────────────────────────

export interface SetupAccessUrl {
  kind: "setup" | "api" | "mission_control" | "video" | "mavlink" | "cloud";
  label: string;
  url: string;
  source: "local" | "hotspot" | "usb" | "mdns" | "cloud" | "configured";
  primary: boolean;
}

export type SetupStepState =
  | "complete"
  | "needs_action"
  | "optional"
  | "blocked"
  | "not_applicable";

export interface SetupStep {
  id: string;
  label: string;
  state: SetupStepState;
  detail: string;
  action_label: string;
  href: string;
}

export interface CloudChoiceStatus {
  mode: "cloud" | "self_hosted" | "local";
  paired: boolean;
  pair_code_required: boolean;
  backend_url: string;
  backend_reachable: boolean;
  last_checked: string | null;
}

export interface ProfileSuggestion {
  detected: "drone" | "ground_station" | "unconfigured";
  ground_role_hint: "direct" | "relay" | "receiver";
  ground_score: number;
  air_score: number;
  mesh_capable: boolean;
  signals: Record<string, boolean>;
  confirmed: boolean;
  detected_at: string | null;
}

export type HardwareCheckItemState =
  | "ok"
  | "missing"
  | "warning"
  | "checking"
  | "unknown";

export interface HardwareCheckItem {
  id: string;
  label: string;
  required: boolean;
  state: HardwareCheckItemState;
  detail: string;
  fix_hint: string;
}

export interface HardwareCheckStatus {
  profile: string;
  ground_role: string;
  items: HardwareCheckItem[];
  last_run: string;
}

export interface SetupActionResult {
  ok: boolean;
  message: string;
  data: Record<string, unknown>;
}

export interface SetupStatus {
  version: string;
  device_id: string;
  device_name: string;
  profile: string;
  /** Distributed-RX role for ground-station profile. Empty for drone profile. */
  ground_role?: string;
  setup_complete: boolean;
  setup_finalized?: boolean;
  completion_percent: number;
  next_action: string;
  steps: SetupStep[];
  access_urls: SetupAccessUrl[];
  network: {
    hostname: string;
    mdns_host: string;
    api_port: number;
    hotspot_enabled: boolean;
    hotspot_ssid: string;
    local_ips: string[];
  };
  mavlink: {
    connected: boolean;
    port: string | null;
    baud: number | null;
    websocket_url: string | null;
    public_websocket_url: string | null;
  };
  video: {
    state: string;
    whep_url: string | null;
    public_whep_url: string | null;
    recording: boolean;
  };
  remote_access: {
    provider: "none" | "cloudflare";
    enabled: boolean;
    configured: boolean;
    status: "disabled" | "configured" | "running" | "stopped" | "error";
    public_urls: string[];
    error: string;
  };
  services: Array<Record<string, unknown>>;
  telemetry: Record<string, unknown>;
  cloud_choice?: CloudChoiceStatus;
  profile_suggestion?: ProfileSuggestion;
  hardware_check?: HardwareCheckStatus | null;
  skipped_steps?: string[];
}

// ── Consolidated ───────────────────────────────────────

/**
 * Air-side USB camera recovery state, mirroring the agent's
 * camera-recovery supervisor. `state` walks the recovery ladder:
 * "idle" (nothing to do) → "monitoring" (a missing camera is being
 * watched) → "rebinding" / "port_cycling" / "hub_resetting" (an active
 * self-heal step is in flight) → "needs_hub_reset" (a powered-hub reset
 * is required but cannot be done in software) / "guard_blocked" (held
 * back to protect another subsystem) / "exhausted" (gave up after the
 * attempt budget). `case` is the agent's free-form diagnosis of why the
 * camera is missing (e.g. "present_wedged", "absent", "port_cycle",
 * "hub_reset") or null when unknown. All fields are reported together;
 * the whole block is absent on agents that predate the surface. */
export interface CameraUsbRecovery {
  state:
    | "idle"
    | "monitoring"
    | "rebinding"
    | "port_cycling"
    | "hub_resetting"
    | "needs_hub_reset"
    | "guard_blocked"
    | "exhausted";
  /** Agent's diagnosis of the missing-camera case, or null when unknown. */
  case: string | null;
  /** Recovery attempts in the current episode. */
  attempts: number;
  /** Attempt budget before the agent gives up (transitions to exhausted). */
  maxAttempts: number;
  /** True when a camera is currently enumerated on the bus. */
  cameraPresent: boolean;
  /** True when the agent expects a camera to be present (one was assigned). */
  expected: boolean;
  /** True when the adapter/port supports per-port power cycling. */
  pppsCapable: boolean;
  /** True when the camera shares an over-subscribed USB hub (no per-port
   * power) with the high-draw radio — a brown-out risk. The fix is to move
   * the camera to a separate port or a self-powered hub. */
  powerContention: boolean;
  /** The bind id of the device the camera contends with (the radio), or null. */
  contentionPeer: string | null;
}

/** Response from `/api/status/full` (agent v0.3.19+). */
export interface FullStatusResponse {
  version: string;
  uptime_seconds: number;
  board: BoardInfo;
  health: HealthInfo;
  fc_connected: boolean;
  fc_port: string;
  fc_baud: number;
  /** Gated MAVLink truth, siblings of `fc_connected`. The current native agent
   * front emits these in camelCase on the wire; `getFullStatus` normalises them
   * to these snake-case fields at the fetch boundary
   * (`normalizeFullStatusLiveness`). Absent on agents that predate the gated
   * truth (the LAN-direct path then falls back to `fc_connected` alone). */
  transport_open?: boolean;
  mavlink_alive?: boolean;
  heartbeat_age_s?: number | null;
  fc_source?: FcSource;
  /** Diagnostic hint for a not-alive link (`"none"` | `"msp_detected"` |
   * `"no_heartbeat"`). Absent on older agents. */
  fc_link_hint?: string;
  /** Protocol family identified on the FC serial link (`"betaflight"` |
   * `"inav"` for an MSP FC). Drives adapter selection on the LAN-direct path.
   * Absent on ArduPilot / PX4 / an unidentified FC / older agents. */
  fc_variant?: string;
  /** The agent's own honest connected-or-reachable verdict, true for a healthy
   * MSP FC that never emits a MAVLink heartbeat. Absent on older agents. */
  fc_reachable?: boolean;
  /** Canonical FC firmware family (`"ardupilot"` | `"px4"` | `"betaflight"` |
   * `"inav"` | `"unknown"`), distinguishing the two MAVLink stacks. Absent on
   * older agents. */
  fc_firmware?: string;
  services: Array<{ name: string; state: string; task_done: boolean; uptimeSeconds: number }>;
  resources: { cpu_percent: number; memory_percent: number; disk_percent: number; temperature: number | null };
  video: {
    state: string;
    whep_url: string | null;
    /** Per-leg video streams on a multi-stream node (each `whep` is the agent's
     * own-host WHEP URL, re-pointed to the reachable host by the client).
     * `live` is the agent's per-leg liveness sample: `false` = a known-dead leg;
     * `true` = producing; absent/`null` = not-yet-sampled or an idle on-demand
     * secondary (treated as selectable, never dead). */
    streams?: {
      id: string;
      role?: string;
      codec?: string;
      whep: string;
      live?: boolean | null;
    }[];
  };
  telemetry: Record<string, unknown>;
  /** Newer agents include the capabilities snapshot here. Optional for older agents. */
  capabilities?: Record<string, unknown>;
  /** WFB radio snapshot (camelCase) for the LAN-direct path. Optional for older agents. */
  radio?: Record<string, unknown> | null;
  /** CRSF / ExpressLRS RC control-lane snapshot: the lane's crsf-stats sidecar
   * body, folded in VERBATIM (raw snake_case) when the lane is live. The agent
   * emits it profile-agnostically — a ground station OR a drone running the ELRS
   * relay lane carries it — and OMITS the key entirely when the lane is down or
   * its sidecar is stale, never a fabricated all-null block. The store's
   * `normalizeCrsf` folds the snake_case body onto the CrsfState shape and reads
   * an absent key as no lane. Optional for older agents. */
  crsf?: Record<string, unknown> | null;
  /** Native-vs-packaged aggregate for the node. Lets the LAN-direct
   * path light the same per-node runtime badge the cloud heartbeat
   * does. Optional for older agents that predate the field. */
  runtimeMode?: "native" | "hybrid" | "packaged";
  /** Resolved node profile (wire form, e.g. "drone" | "ground-station" |
   * "workstation"). Lets the LAN-direct path tell a ground station apart so it
   * can prefer that profile's ticket-gated MAVLink endpoint. Optional for
   * older agents that predate the field on the consolidated status. */
  profile?: string;
  /** WFB peer this node decoded from a bind PresenceBeacon (a ground node
   * carries the drone's id; a drone carries the ground node's). Carried on the
   * LAN-direct status so local-first transitive enrollment works without the
   * cloud relay. Null / absent when no peer is currently decoded. */
  peerDeviceId?: string | null;
  /** Peer-reported RSSI in dBm (signed), paired with `peerDeviceId`. */
  peerRssiDbm?: number | null;
  /** Every WFB peer this node reports (a ground node can relay more than one
   * drone). Each entry carries the peer id and, when known, rssi / role /
   * channel / seen-at. Preferred over the scalar `peerDeviceId`. Absent on
   * agents that predate the list. */
  linked_peers?: Array<{
    device_id?: string;
    rssi_dbm?: number | null;
    role?: string | null;
    channel?: number | null;
    seen_at_unix?: number | null;
  }>;
  /** Air-side camera discovery state ("ready" | "missing" | "error").
   * Carried at the top level of `/api/status/full` so the LAN-direct
   * path lights the same "No camera" surfaces the cloud heartbeat does.
   * Optional / null on agents that predate the surface. */
  cameraState?: string | null;
  /** Air-side USB camera recovery state. Carried at the top level of
   * `/api/status/full`. Absent on agents that predate the surface. */
  cameraUsbRecovery?: CameraUsbRecovery;
  /** MAVLink access descriptor (ground-station profile). Carries the
   * ticket-gated authenticated WebSocket endpoint as an absolute URL
   * and/or a path relative to the agent's :8080 front. Absent on agents
   * that predate the gated endpoint. The LAN-direct path resolves this
   * into the dialable URL the MAVLink bridge prefers. */
  mavlink?: MavlinkAccess;
}

/**
 * MAVLink access descriptor advertised on `/api/status` and
 * `/api/status/full` (ground-station profile). `authenticated_websocket_url`
 * is an absolute ws/wss URL; `authenticated_websocket_path` is a path
 * relative to the agent's :8080 front (resolved against the LAN host when
 * the absolute URL is absent). Both null on agents that predate the gated
 * endpoint or on a non-ground-station profile.
 */
export interface MavlinkAccess {
  authenticated_websocket_url?: string | null;
  authenticated_websocket_path?: string | null;
}

// ── Pairing ─────────────────────────────────────────────

export interface PairingInfo {
  device_id: string;
  name: string;
  version: string;
  board: string;
  paired: boolean;
  pairing_code?: string;
  owner_id?: string;
  paired_at?: number;
  mdns_host: string;
}

export interface ClaimResponse {
  api_key: string;
  device_id: string;
  name: string;
  mdns_host: string;
}
