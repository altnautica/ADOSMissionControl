/**
 * @module FeatureTypes
 * @description Aggregate agent capability record.
 * @license GPL-3.0-only
 */

import type { CameraUsbRecovery } from "../types";
import type { NodeFlags } from "../node-flags";
import type {
  AttachedDisplay,
  CameraCapability,
  ComputeCapability,
  ModelCacheInfo,
  VideoLocalTap,
  VideoStreamLeg,
  VisionState,
  VisionSummary,
} from "./media";
import type {
  CanBusInfo,
  MacStability,
  ManagementLink,
  NavigationCapability,
  WifiPowersave,
} from "./node-health";

export interface AgentCapabilities extends NodeFlags {
  /** Board tier, absent when no board sidecar reported one. A boardless node
   *  (compute/workstation, or an unmatched board) has NO tier; 0 is not a
   *  tier and reads as a real, lowest-capability board. */
  tier?: number;
  cameras: CameraCapability[];
  videoStreams: VideoStreamLeg[];
  compute: ComputeCapability;
  vision: VisionState;
  models: ModelCacheInfo;
  /** Optional. Per-port CAN bus configuration the agent harvests from
   * the persisted FC parameter cache. Absent during the warmup window
   * between FC connect and the first parameter download, and absent
   * entirely on FCs that expose no CAN ports. Empty array means the
   * agent has the params but reports both ports as disabled. */
  canBuses?: CanBusInfo[];
  /** Setup wizard state on the agent. Live agents report "configured"
   * once the universal webapp wizard has been completed. Older agents
   * omit this and the GCS treats them as configured by default. */
  setupState?: string;
  /** How the agent landed on its current profile. One of "detected"
   * (auto-detected by hardware fingerprint), "tiebreaker" (auto with
   * ambiguous signals), "default" (no detect signals, fell back),
   * "override" (forced via /etc/ados/board_override), or "user"
   * (operator picked in the setup webapp). Undefined for legacy
   * heartbeats that predate this field. */
  profileSource?: string;
  /** Optional. Present only when an SPI LCD or other companion-board
   * display is bound on the agent side. Absent on stock drone or
   * headless ground-station builds. */
  display?: AttachedDisplay;
  /** Optional. State of the agent's local-LCD video appsink tap.
   * Undefined when the agent does not bind a local display or has
   * not yet shipped local-tap support. */
  videoLocalTap?: VideoLocalTap;
  /** Optional. True when the agent is currently recording the main
   * video stream to disk. Drives the "REC" badge on the drone card
   * and the recording status pill in the Video sub-view. */
  videoRecording?: boolean;
  /** Optional. Theme the operator picked for the local LCD UI. The
   * GCS mirrors this back into the WelcomeModal preference flow so
   * the drone and the desktop stay in sync. */
  uiTheme?: "dark" | "light";
  /** Optional. Number of pipeline restarts since the last healthy
   * interval. The agent resets this once video stays up for the
   * configured cool-down. The GCS surfaces a banner when the count
   * crosses an unhealthy threshold. Undefined for legacy heartbeats. */
  videoRestartAttempts?: number;
  /** Optional. Agent-authoritative pairing-code expiry (epoch
   * seconds). Mirrors the timer the agent's local wizard is showing
   * so the cloud-side countdown matches the physical device. Null
   * when the agent has no pending code; undefined for legacy
   * heartbeats. */
  pairingCodeExpiresAt?: number | null;
  /** Optional. The ticket-gated authenticated MAVLink WebSocket
   * endpoint the agent serves on its front. Either an absolute
   * ws:// / wss:// URL or a path resolved against the agent front.
   * When present the GCS mints a `gs.mavlink_ws` ticket and dials this
   * (with the ticket carried as a WebSocket subprotocol) in preference
   * to the legacy raw proxy. Absent on agents that predate the gated
   * endpoint, in which case the GCS falls back to the raw proxy. */
  mavlinkWsAuthenticated?: string | null;
  /** Optional. Tracks how the agent is currently servicing the
   * pairing/uplink path. "local" is the steady state on the wireless
   * radio link. "cloud_relay" means the local pairing supervisor
   * fell over to the cloud heartbeat path; the GCS surfaces a notice
   * with a retry control. "failed" means both local and cloud paths
   * are unavailable. Undefined for legacy heartbeats. */
  wfbFailoverState?: "local" | "cloud_relay" | "failed";
  /** Optional. Camera + vision navigation capability advertised every
   * heartbeat. Drives the fleet GPS-denied pill, the pre-arm vision
   * row, and the Vision Navigation tab. Undefined when the agent has
   * not wired the navigation surfaces. */
  navigation?: NavigationCapability;
  /** Optional. Effective primary local-display path the agent resolved
   * for the current heartbeat. The agent emits one of "hdmi" | "lcd" |
   * "none"; the GCS additionally accepts "auto" so a config-echo
   * payload (which may carry the unresolved override) stays in-band.
   * Distinct from `display.type` which describes the bound SPI LCD
   * peripheral specifically. Undefined on agents that predate the
   * enrichment. */
  displayType?: "auto" | "hdmi" | "lcd" | "none" | null;
  /** Optional. Inter-rig peer device-id, populated from WFB-radio
   * presence beacons (control plane, radio_id 1). Surfaces on the
   * drone card so the operator sees a stable peer link before any
   * MAVLink traffic flows. Truncated to 16 ASCII characters by the
   * agent's beacon encoder. Undefined when no beacon has decoded or
   * the agent predates the presence-beacon surface. */
  peerDeviceId?: string | null;
  /** Optional. "drone" or "gs" — which side of the radio pair the
   * peer identifies itself as. Lets the GCS render the correct icon
   * (drone receiving a GS beacon vs GS receiving a drone beacon). */
  peerRole?: string | null;
  /** Optional. Channel the peer reports it is currently sitting on.
   * Differs from the local channel during the short window between a
   * HopAck and the next presence beacon. */
  peerChannel?: number | null;
  /** Optional. Peer-reported RSSI in dBm, signed. 0 means unknown
   * rather than 0 dBm. */
  peerRssiDbm?: number | null;
  /** Optional. UNIX seconds the local listener last decoded a beacon
   * from the peer. Used to compute freshness; the agent itself drops
   * a "stale" snapshot to null after 60 s of silence. */
  peerSeenAtUnix?: number | null;
  /** Optional. Air-side camera discovery state. "ready" when a
   * primary v4l2 node is assigned; "missing" when discovery completed
   * with zero cameras (most commonly a USB camera that's wedged or
   * unplugged); "error" when the discovery probe itself failed.
   * Undefined for agents that predate the cross-process camera-state
   * snapshot. */
  cameraState?: string | null;
  /** Optional. Air-side USB camera recovery state, mirroring the agent's
   * camera-recovery supervisor (idle / monitoring / rebinding /
   * port_cycling / hub_resetting / retrying / needs_hub_reset /
   * guard_blocked). Lets the GCS show a self-heal in flight, or a camera
   * that needs a physical reseat, without SSH'ing in. Undefined on
   * agents that predate the surface. */
  cameraUsbRecovery?: CameraUsbRecovery;
  /** Optional. True when this drone can run the vision engine. Inferred
   * from an advertised vision backend / active model, or as a fallback
   * from an NPU-bearing SoC. Gates the per-drone Vision tab. Undefined
   * on agents that predate the vision surface (the tab stays hidden). */
  visionAvailable?: boolean;
  /** Optional. Compact live-detection summary forwarded each heartbeat
   * when a detection model is loaded. Undefined when the agent has not
   * wired the vision surface or the engine is fully idle. */
  visionSummary?: VisionSummary;
  /** Optional. How the agent's long-running / safety-critical systems
   * services are running: "native" (compiled binary), "hybrid" (a mix
   * of native and interpreted fallback), or "packaged" (distributed
   * package build). Undefined for agents that don't report a runtime
   * mode. Forward-compatible: an unrecognized value normalizes to
   * undefined so the badge stays hidden. */
  runtimeMode?: "native" | "hybrid" | "packaged";
  /** Optional. Overall health of the on-board radio stack, distinct
   * from the moment-to-moment pairing state:
   *   - "ok"               — radio stack present and able to inject.
   *   - "no_injection"     — no injection-capable adapter found; the
   *                          agent refuses to transmit.
   *   - "unpaired"         — stack is up but no peer is bound yet.
   *   - "no_bind_artifacts"— a paired record exists but its keys or
   *                          channel are missing on disk.
   *   - "stack_incomplete" — the radio driver or transport binaries
   *                          are not installed.
   * Drives a diagnostic line on the overview so a regression in the
   * radio install reads distinctly from a plain "not paired".
   * Undefined for agents that predate the field, and an unrecognized
   * value normalizes to undefined so the line stays hidden. */
  radioStackState?:
    | "ok"
    | "no_injection"
    | "unpaired"
    | "no_bind_artifacts"
    | "stack_incomplete";
  /** Per-adapter stable-MAC pin verdicts. Undefined on boards with no
   * no-efuse randomizer (the common case). */
  macStability?: MacStability;
  /** Operator management-link health from the agent's link guardian.
   * Undefined on agents that predate the guardian. */
  managementLink?: ManagementLink;
  /** Per-interface WiFi power-save reconciler verdicts from the agent.
   * Undefined on agents that predate the reconciler or profiles with no
   * managed WiFi interface. */
  wifiPowersave?: WifiPowersave;
  /** Management-link reach-back mode from the agent's failover reconciler:
   * "primary" (wired link up) | "wifi_heartbeat" (degraded, status-only over
   * onboard WiFi — video and full telemetry do not flow) | "none" (no
   * reach-back). Undefined on agents that predate the reconciler; an
   * unrecognized value normalizes to undefined. */
  mgmtLinkMode?: "primary" | "wifi_heartbeat" | "none";
  /** The interface carrying the heartbeat reach-back when failed over. */
  mgmtFailoverIface?: string | null;
  /** Why the box failed over (e.g. "primary_carrier_down"). */
  mgmtFailoverReason?: string | null;
  /** USB-rehome self-heal state for a WFB adapter on a slow USB port:
   * "idle" | "rehoming" (unbind/rebind in progress, or retrying on the
   * cooldown) | "guard_blocked" (held back to protect the management link).
   * Recovery has no attempt budget, so it never gives up. Undefined on agents
   * that predate the self-heal. */
  usbRehomeState?: "idle" | "rehoming" | "guard_blocked";
  /** Rehome attempts in the current episode. */
  usbRehomeAttempts?: number | null;
  /** The last rehome outcome (e.g. "success", "retry", "guard_blocked"). */
  usbRehomeLastResult?: string | null;
  /** NPU compute headroom in TOPS — a top-level mirror of
   * `compute.npu_tops` the tier signal keys off. Undefined on agents that
   * predate the perception-tier surface. */
  npuTops?: number;
  /** True when the node has any inference accelerator (NPU or GPU) it can
   * run a detector on locally. Undefined on agents that predate the field;
   * a consumer falls back to `compute.npu_available || compute.gpu_available`. */
  hasAccelerator?: boolean;
  /** The perception execution tier the agent resolved for this node:
   *   - "local"  — the model runs on the node's own NPU (on-edge).
   *   - "offload"— the node streams frames to a workstation that runs it.
   *   - "cpu"    — the detector runs on the node's own CPU (no accelerator).
   *   - "hybrid" — a mix of local and offloaded pipelines.
   *   - "none"   — no perception is running / no path available.
   * Undefined on agents that predate the tier signal; an unrecognized value
   * normalizes to undefined so the surface reads "unknown" rather than a
   * fabricated tier. */
  perceptionTier?: "local" | "cpu" | "offload" | "hybrid" | "none";
  /** The workstation node the agent offloads perception to (a device id /
   * host), or null when it runs locally or has no target. Undefined on agents
   * that predate the field. */
  perceptionOffloadTarget?: string | null;
}
