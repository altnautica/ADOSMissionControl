/**
 * @module AgentCapabilities/Types
 * @description Shared TypeScript types for the per-drone agent-capabilities
 * Zustand store. Split out from the original store file so the state shape,
 * normalizer, and create() body can live in their own modules without
 * circular imports.
 * @license GPL-3.0-only
 */

import type {
  AgentCapabilities,
  CameraCapability,
  VideoStreamLeg,
  CanBusInfo,
  ComputeCapability,
  VisionState,
  VisionSummary,
  ModelCacheInfo,
  NavigationCapability,
} from "@/lib/agent/feature-types";
import type { RadioState, CrsfState } from "@/lib/api/ground-station/types";

/**
 * Manual-connection URL block the agent advertises so an operator can dial
 * MAVLink or video directly from a workstation on the same LAN. Each field
 * is independently nullable because the agent may know one URL but not the
 * other (e.g., MAVLink TCP listener up but video pipeline not running).
 */
export interface ManualConnectionUrls {
  mavlinkTcp: string | null;
  mavlinkWs: string | null;
  videoViewer: string | null;
  videoWhep: string | null;
}

/** Node deployment category. Drives Command-tab panel selection. */
export type AgentProfile = "drone" | "ground-station" | "workstation";

/** How the agent's systems services are running. "native" means the
 * long-running / safety-critical services are the compiled binary;
 * "hybrid" means a mix of the native binary and the interpreted
 * fallback; "packaged" is the distributed-package build. Undefined for
 * agents that don't report a runtime mode. */
export type RuntimeMode = "native" | "hybrid" | "packaged";

/** Ground-station role; null on drones and compute nodes. */
export type AgentRole = "direct" | "relay" | "receiver" | null;

/** Current pairing/uplink failover state. */
export type WfbFailoverState = "local" | "cloud_relay" | "failed";

export interface AgentCapabilitiesState {
  tier: number;
  cameras: CameraCapability[];
  /** Addressable per-leg video streams a multi-stream node serves (host-resolved
   * WHEP URLs), for the cockpit stream switcher. Empty on a single-stream node. */
  videoStreams: VideoStreamLeg[];
  compute: ComputeCapability;
  vision: VisionState;
  models: ModelCacheInfo;
  /** Setup wizard state on the agent. Undefined for legacy heartbeats. */
  setupState?: string;
  /** How the agent landed on its current profile. Undefined for legacy
   * heartbeats. See AgentCapabilities.profileSource for the value set. */
  profileSource?: string;
  /** Node deployment category. "drone" or "ground-station" today,
   * "workstation" in the future. Defaults to "drone" when the
   * heartbeat omits the field (older agents). Drives Command-tab
   * panel selection and tab visibility per node. */
  profile: AgentProfile;
  /** Ground-station role when applicable. Null on drones and
   * compute nodes, undefined on agents that predate the field. */
  role?: AgentRole;
  /** How the agent's systems services are running ("native" |
   * "hybrid" | "packaged"). Undefined for legacy heartbeats and for
   * agents that don't yet report a runtime mode. */
  runtimeMode?: RuntimeMode;
  /** Local panel attached to the companion board (e.g. SPI LCD on a
   * ground-station node). Undefined when no display is bound. */
  display: AgentCapabilities["display"];
  /** Effective primary local-display path resolved each heartbeat
   * ("hdmi" | "lcd" | "none"). Reflects the operator's
   * ground_station.display.type setting when explicit; under "auto"
   * the agent probes both renderers and HDMI wins when both are wired.
   * The dropdown in `LocalDisplayCard` writes the configured value
   * (which may also be "auto") via `PUT /config`. Undefined on agents
   * that predate the enrichment. */
  displayType: AgentCapabilities["displayType"];
  /** Snapshot of the agent's local-LCD video appsink tap. Undefined
   * when the agent hasn't shipped local-tap support, or no display
   * is bound. Stays defined with active=false when the tap is
   * explicitly paused. */
  videoLocalTap: AgentCapabilities["videoLocalTap"];
  /** True when the agent is currently recording the main video
   * stream to disk. Undefined for agents that predate the recording
   * surface. */
  videoRecording: AgentCapabilities["videoRecording"];
  /** Theme the operator picked for the local LCD UI. Undefined when
   * the agent has no LCD or hasn't reported a theme yet. */
  uiTheme: AgentCapabilities["uiTheme"];
  /** Air-side video pipeline identity. Undefined when the agent
   * runs the legacy bash composition or hasn't reported yet. */
  videoPipeline: AgentCapabilities["videoPipeline"];
  /** Air-side WFB-ng radio snapshot. Null when the agent does not
   * advertise a radio service (drone has no air-side adapter, or runs
   * a profile without WFB-ng). Populated from the cloud heartbeat or
   * a future /api/capabilities response. */
  radio: RadioState | null;
  /** CRSF / ExpressLRS control-lane snapshot from the ados-crsf service.
   * Null when the node advertises no control lane (no ELRS transmitter, or a
   * profile without the lane) or the lane / its sidecar is down. Populated
   * from the cloud heartbeat `crsf` block or the dedicated LAN
   * `GET /api/v1/ground-station/crsf` route (which is ground-station-only). An
   * `rf_unverified` lane state is carried through as itself — transmitting,
   * reception unproven — never collapsed to connected or down. */
  crsf: CrsfState | null;
  /** Overall radio-stack health, distinct from the live pairing state.
   * "ok" | "no_injection" | "unpaired" | "no_bind_artifacts" |
   * "stack_incomplete". Lets the overview show a diagnostic line when
   * the radio install regresses (driver missing, no injection-capable
   * adapter, bind artifacts gone) so it reads differently from a plain
   * "not paired". Undefined for legacy heartbeats — the line stays
   * hidden until a known value arrives. */
  radioStackState?: AgentCapabilities["radioStackState"];
  /** Per-adapter stable-MAC pin verdicts. Undefined on boards with no
   * no-efuse randomizer. */
  macStability?: AgentCapabilities["macStability"];
  /** Operator management-link health from the agent's link guardian.
   * Undefined on agents that predate the guardian. */
  managementLink?: AgentCapabilities["managementLink"];
  /** Per-interface WiFi power-save reconciler verdicts from the agent.
   * Undefined on agents that predate the reconciler. */
  wifiPowersave?: AgentCapabilities["wifiPowersave"];
  /** Management-link reach-back mode + failover interface/reason. Undefined
   * on agents that predate the failover reconciler. */
  mgmtLinkMode?: AgentCapabilities["mgmtLinkMode"];
  mgmtFailoverIface?: AgentCapabilities["mgmtFailoverIface"];
  mgmtFailoverReason?: AgentCapabilities["mgmtFailoverReason"];
  /** USB-rehome self-heal state + attempt count + last result. Undefined on
   * agents that predate the self-heal. */
  usbRehomeState?: AgentCapabilities["usbRehomeState"];
  usbRehomeAttempts?: AgentCapabilities["usbRehomeAttempts"];
  usbRehomeLastResult?: AgentCapabilities["usbRehomeLastResult"];
  /** Pipeline restarts since the last healthy interval. Resets to
   * zero once video stays up for the agent's healthy cool-down.
   * Default 0 until the agent reports otherwise. */
  videoRestartAttempts: number;
  /** Agent-authoritative pairing-code expiry (epoch seconds). Null
   * when the agent has no pending code or hasn't reported one. */
  pairingCodeExpiresAt: number | null;
  /** Previous MAVLink WebSocket URL the agent advertised, if it
   * rotated its binding. Null when no rotation is in flight. */
  mavlinkWsUrlPrev: string | null;
  /** Current pairing/uplink failover state. "local" is the steady
   * state on the wireless radio link. "cloud_relay" means the
   * agent's local pairing supervisor failed over to the cloud
   * path. "failed" means neither path is up. Defaults to "local"
   * for legacy heartbeats. */
  wfbFailoverState: WfbFailoverState;
  /** LAN-routable manual-connection URLs the agent advertises so
   * the operator can dial directly from a workstation on the same
   * network. Each field independently null when the agent can't
   * compute a usable URL (no MAVLink TCP listener, no video
   * pipeline, etc.). Undefined for legacy heartbeats. */
  manualConnectionUrls: ManualConnectionUrls | null;
  /** Cloud relay backend the agent is paired to (Convex deployment),
   * or null when unpaired. Distinct from Cloudflare tunnel state. */
  cloudRelayUrl: string | null;
  /** Cloudflare tunnel ingress URL when the inbound tunnel is up,
   * or null when disabled. Distinct from cloud relay state. */
  cloudflareUrl: string | null;
  /** Camera + vision navigation capability. Drives the fleet GPS-denied
   * pill, the pre-arm vision row, and the Vision Navigation tab.
   * Undefined when the agent has not wired the navigation surfaces or
   * the heartbeat predates the field. */
  navigation: NavigationCapability | undefined;
  /** Inter-rig peer device-id, sourced from WFB-radio presence beacons.
   * Null when no beacon has been decoded recently. */
  peerDeviceId: string | null;
  /** "drone" or "gs" — peer's self-reported role. Null when unknown. */
  peerRole: string | null;
  /** Channel the peer reports it is currently on. Null when unknown. */
  peerChannel: number | null;
  /** Peer-reported RSSI in dBm (signed). Null when unknown. */
  peerRssiDbm: number | null;
  /** UNIX seconds the local listener last decoded a peer beacon. Null
   * when no beacon decoded. */
  peerSeenAtUnix: number | null;
  /** Air-side camera discovery state ("ready" | "missing" | "error").
   * Null when the agent hasn't reported a state or the agent predates
   * the surface. */
  cameraState: string | null;
  /** Air-side USB camera recovery state, mirroring the agent's
   * camera-recovery supervisor. Undefined when the agent hasn't
   * reported a state or predates the surface. Latest heartbeat wins on
   * merge; a sparse tick keeps the prior view. */
  cameraUsbRecovery: AgentCapabilities["cameraUsbRecovery"];
  /** True when the drone can run the vision engine. Inferred from an
   * advertised backend / active model, or an NPU-bearing SoC fallback.
   * Gates the per-drone Vision tab. Undefined on agents that predate
   * the vision surface. */
  visionAvailable: boolean | undefined;
  /** Compact live-detection summary (active model + backend + rolling
   * throughput) forwarded each heartbeat when a detection model is
   * loaded. Undefined when the agent has not wired the vision surface
   * or the engine is fully idle. Latest heartbeat wins on merge; a
   * sparse tick keeps the prior view. */
  visionSummary: VisionSummary | undefined;
  /** Per-port CAN bus configuration harvested from the FC parameter
   * cache. Undefined during the warmup window before the first
   * parameter download finishes; empty array when the agent has the
   * params but reports both ports as disabled. Latest heartbeat wins
   * on merge so a sparse tick keeps the prior view. */
  canBuses: CanBusInfo[] | undefined;
  /** Resolved perception execution tier ("local" | "offload" | "hybrid" |
   * "none"). Undefined on agents that predate the tier signal — the
   * Perception hub then reads it as "unknown" rather than a fabricated tier. */
  perceptionTier?: AgentCapabilities["perceptionTier"];
  /** The workstation node the agent offloads perception to, or null when it
   * runs locally. Undefined on agents that predate the field. */
  perceptionOffloadTarget?: AgentCapabilities["perceptionOffloadTarget"];
  /** NPU headroom in TOPS (top-level mirror of compute.npu_tops). Undefined
   * on agents that predate the field. */
  npuTops?: AgentCapabilities["npuTops"];
  /** True when the node has an inference accelerator (NPU or GPU). Undefined
   * on agents that predate the field. */
  hasAccelerator?: AgentCapabilities["hasAccelerator"];
  /** True once we've received at least one capabilities payload. */
  loaded: boolean;
}

export interface AgentCapabilitiesActions {
  /** Update all capabilities from a parsed API response (normalizes shape). */
  setCapabilities: (caps: AgentCapabilities | Record<string, unknown>) => void;
  /** Reset store on disconnect. */
  clear: () => void;
}

export type AgentCapabilitiesStore = AgentCapabilitiesState &
  AgentCapabilitiesActions;
