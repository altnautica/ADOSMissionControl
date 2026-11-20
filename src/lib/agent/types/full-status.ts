/**
 * @module AgentTypes
 * @description Narrowing for the `/api/status/full` blocks. The top-level
 * shape is generated from the agent's schema (`StatusFull` in
 * `@/lib/agent/agent-api.generated`); its nested blocks and fold keys arrive
 * as `unknown`, and the interfaces here name the shapes the GCS reads.
 * @license GPL-3.0-only
 */

import type { StatusFull } from "../agent-api.generated";
import type { BoardInfo, FcSource, HealthInfo } from "./status";

// ── Consolidated ───────────────────────────────────────

/**
 * Air-side USB camera recovery state, mirroring the agent's
 * camera-recovery supervisor. `state` walks the recovery ladder:
 * "idle" (nothing to do) → "monitoring" (an expected camera is missing and
 * being watched) → "rebinding" / "port_cycling" / "hub_resetting" (an active
 * self-heal step is in flight) → "retrying" (waiting out the cooldown before
 * the next attempt) → "needs_hub_reset" (a powered-hub reset is required but
 * cannot be done in software) / "guard_blocked" (held back to protect another
 * subsystem). The supervisor never gives up: it keeps retrying on the
 * cooldown, so there is no attempt budget. `case` is the agent's free-form
 * diagnosis of why the camera is missing (e.g. "present_wedged", "absent",
 * "port_cycle", "hub_reset") or null when unknown. All fields are reported
 * together; the whole block is absent on agents that predate the surface. */
export interface CameraUsbRecovery {
  state:
    | "idle"
    | "monitoring"
    | "rebinding"
    | "port_cycling"
    | "hub_resetting"
    | "retrying"
    | "needs_hub_reset"
    | "guard_blocked";
  /** Agent's diagnosis of the missing-camera case, or null when unknown. */
  case: string | null;
  /** Recovery attempts in the current episode. */
  attempts: number;
  /** Seconds the supervisor waits between attempts; 0 when not reported. */
  cooldownSeconds: number;
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

/** One `services` row: systemd ActiveState in `state`, the unit's sub-state
 * in `sub_state`. A unit whose start systemd skipped on an unmet unit
 * condition reads `state: "idle"`, `reason: "condition_unmet"`. No uptime:
 * the agent does not measure one here. */
export interface StatusFullServiceRow {
  name: string;
  state: string;
  sub_state?: string;
  reason?: string;
  task_done: boolean;
  memory_mb?: number;
}

/** `resources`: any field is absent when the agent could not take that
 * reading. */
export interface StatusFullResources {
  cpu_percent?: number;
  memory_percent?: number;
  disk_percent?: number;
  temperature?: number | null;
}

/** One per-leg stream on a multi-stream node. `whepUrl` is the agent's
 * same-origin relative WHEP path, resolved against the reachable host.
 * `live` is the agent's per-leg liveness sample: `false` = a known-dead leg;
 * `true` = producing; absent/`null` = not-yet-sampled or an idle on-demand
 * secondary (treated as selectable, never dead). */
export interface StatusFullVideoStream {
  id: string;
  role?: string;
  codec?: string;
  whepUrl: string;
  /** Relative HLS playlist for this leg (`/hls/<id>/index.m3u8`), read by the
   * agent's on-box cockpit, not this client. */
  hls?: string;
  live?: boolean | null;
}

/** `video` block. */
export interface StatusFullVideo {
  state: string;
  whep_url: string | null;
  /** Primary HLS playlist (relative `/hls/main/index.m3u8` on current
   * agents). Consumed by the agent's own on-box cockpit, which falls back
   * WHEP→HLS on the drone's local display; Mission Control never plays it,
   * because HLS sits 2-6 s behind live and a piloting surface cannot present
   * that as current. */
  hls_url?: string | null;
  streams?: StatusFullVideoStream[];
  /** The hardware encoder failed and the encoder was pinned to software. */
  encoder_forced_software?: boolean;
}

/** One `linked_peers` entry: a WFB peer this node reports. */
export interface StatusFullLinkedPeer {
  device_id?: string;
  rssi_dbm?: number | null;
  role?: string | null;
  channel?: number | null;
  seen_at_unix?: number | null;
}

/** FC liveness in the snake_case the GCS reads. The agent emits these in
 * camelCase; `normalizeFullStatusLiveness` bridges them at the fetch
 * boundary. Absent when neither casing was present. */
export interface SnakeFcLiveness {
  transport_open?: boolean;
  mavlink_alive?: boolean;
  heartbeat_age_s?: number | null;
  fc_source?: FcSource;
  /** `"none"` | `"msp_detected"` | `"no_heartbeat"`. */
  fc_link_hint?: string;
  /** `"betaflight"` | `"inav"` for an MSP FC; absent otherwise. */
  fc_variant?: string;
  /** `"ardupilot"` | `"px4"` | `"betaflight"` | `"inav"` | `"unknown"`. */
  fc_firmware?: string;
  /** The agent's own connected-or-reachable verdict, true for a healthy MSP
   * FC that never emits a MAVLink heartbeat. */
  fc_reachable?: boolean;
  /** The FC link reads connected but GCS commands to the FC are dropped. */
  fc_command_down_gated?: boolean;
}

/** `/api/status/full` as `getFullStatus` returns it: the generated wire shape
 * with the FC liveness bridged to snake_case, its `unknown` blocks narrowed,
 * and the fold keys it carries through its index signature named. Fold keys
 * are present only while their `/run/ados` sidecar is fresh. */
export interface LanStatusFull extends StatusFull, SnakeFcLiveness {
  board: BoardInfo;
  health: HealthInfo;
  services: StatusFullServiceRow[];
  resources: StatusFullResources;
  video: StatusFullVideo;
  telemetry: Record<string, unknown>;
  /** WFB radio snapshot (camelCase). */
  radio: Record<string, unknown> | null;
  /** CRSF / ExpressLRS control-lane snapshot: the lane's crsf-stats sidecar
   * body folded in verbatim (raw snake_case). The key is omitted when the
   * lane is down or its sidecar is stale. */
  crsf?: Record<string, unknown> | null;
  /** WFB peer decoded from a bind PresenceBeacon. */
  peerDeviceId?: string | null;
  /** Peer-reported RSSI in dBm, paired with `peerDeviceId`. */
  peerRssiDbm?: number | null;
  /** A fleet slot delivered to the drone and the radio restart it is owed
   * (`outcome`, `fleetId`, `fleetSlot`, ...); omitted when none was written. */
  radioFleetApply?: Record<string, unknown> | null;
  /** Every WFB peer this node reports. Preferred over `peerDeviceId`. */
  linked_peers?: StatusFullLinkedPeer[];
  /** Air-side camera discovery state ("ready" | "missing" | "error"). */
  cameraState?: string | null;
  cameraUsbRecovery?: CameraUsbRecovery;
  /** Pass-through blocks: `agent-capabilities/normalizer.ts` clamps them
   * onto `ManagementLink` / `WifiPowersave`. */
  managementLink?: Record<string, unknown> | null;
  wifiPowersave?: Record<string, unknown> | null;
  mgmtLinkMode?: "primary" | "wifi_heartbeat" | "none";
  mgmtFailoverIface?: string | null;
  mgmtFailoverReason?: string | null;
  /** "idle" | "rehoming" | "guard_blocked". */
  usbRehomeState?: "idle" | "rehoming" | "guard_blocked";
  usbRehomeAttempts?: number | null;
  usbRehomeLastResult?: string | null;
  /** Per-adapter stable-MAC verdicts (`{adapters: [...]}`), camelCase at the
   * source. */
  macStability?: Record<string, unknown> | null;
  /** The FC identity reconciler's last verdict, or null before its first
   * tick. */
  fc_identity: FcIdentityVerdictWire | null;
  /** The router's direct-GCS proxy posture, or null when unpublished. */
  mavlink_proxy_posture?: MavlinkProxyPostureWire | null;
  /** True when the FC drops the agent's unsigned frames; null unmeasured. */
  agent_commands_unsigned_rejected_risk?: boolean | null;
  /** `active` | `inactive_no_local_arbiter` | `off`; null unpublished. */
  injector_arbitration?: string | null;
  /** Whether the agent signs its own frames: `off` | `active` | `no_key`. */
  agent_signing?: string | null;
}

/** `fc_identity` on `/api/status/full`: the reconciler's sidecar verbatim. */
export interface FcIdentityVerdictWire {
  version?: number;
  enabled?: boolean;
  /** `disabled` | `in_sync` | `deferred_armed` | `written` | `error`. */
  outcome?: string;
  wanted_system_id?: number | null;
  current_system_id?: number | null;
  at_ms?: number;
}

/** `mavlink_proxy_posture`: configured binds plus the per-edge listening
 * flags. `ws_listening` is null with no WebSocket endpoint configured. */
export interface MavlinkProxyPostureWire {
  tcp_listening?: boolean;
  /** One flag per configured UDP port, in port order. */
  udp_listening?: boolean[];
  ws_listening?: boolean | null;
  [configured: string]: unknown;
}
