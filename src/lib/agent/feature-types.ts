/**
 * @module FeatureTypes
 * @description Agent capability types: hardware, compute, vision state, model
 *   cache, navigation, display, and pipeline metadata reported by the agent's
 *   heartbeat and `/api/capabilities` endpoint.
 * @license GPL-3.0-only
 */

import type { CameraUsbRecovery } from "./types";

// ── Agent Capabilities (from /api/status/full) ───────────

export interface CameraCapability {
  name: string;
  type: "csi" | "usb" | "ip";
  device?: string;
  resolution: string;
  fps?: number;
  streaming: boolean;
}

/** One addressable video LEG a node serves (a smart pod / dual-camera rig),
 * distinct from the {@link CameraCapability} probe roster: it has a stable
 * mediamtx-path id and a resolved WHEP URL the GCS stream switcher can connect
 * to directly. Populated (host-resolved) by the status/heartbeat producers. */
export interface VideoStreamLeg {
  /** Stable per-drone stream id (the mediamtx path + WHEP id). */
  id: string;
  /** Logical sensor role: eo / eo_wide / ir / split — drives the tab label. */
  role?: string;
  codec?: string;
  /** Fully-resolved WHEP URL against the node's reachable host. */
  whepUrl: string;
  /** Agent-sampled per-leg liveness: `false` = a known-dead leg (its source is
   * not producing), rendered disabled and never auto-selected; `true` = live;
   * absent/`null` = not-yet-sampled or an idle on-demand secondary with no
   * reader — treated as selectable, never dead. */
  live?: boolean | null;
}

/** Coarse physical mount of a camera on the airframe. A leg declares one so the
 * roster can badge it and a plugin can bind "the down-facing camera" by
 * orientation rather than a device path. */
export const CAMERA_ORIENTATIONS = [
  "forward",
  "down",
  "back",
  "left",
  "right",
  "up",
  "gimbal",
  "custom",
] as const;

/** What a camera leg is used for. A leg carries zero or more purposes; a plugin
 * binds a camera by required purpose (e.g. `detect`, `precision-landing`). */
export const CAMERA_PURPOSES = [
  "feed",
  "detect",
  "navigation",
  "precision-landing",
  "thermal",
  "mapping",
  "recording",
] as const;

/** Where a camera roster row sits: assigned to a stream, an unassigned
 * discovered device, owned by a plugin (read-only to the operator), or a
 * declared device that is currently absent. */
export type RosterCameraState =
  | "assigned"
  | "discovered_unassigned"
  | "plugin_owned"
  | "offline";

/** A physical-device fingerprint that re-pins a leg's logical id across a
 * hot-plug or reboot (a USB `vid:pid[:serial]`, or a CSI sensor + port). */
export interface CameraFingerprint {
  usb?: string;
  csi_sensor?: string;
  csi_port?: number;
}

/** One row of the camera roster the agent's `GET /api/video/roster` returns:
 * a declared leg, a discovered device, or the reconciliation of both, with the
 * management metadata (name / orientation / purpose / owner / mount) plus a
 * `state` telling the operator what it is. Nullable fields are `null` when the
 * agent has no value, never fabricated. */
export interface RosterCamera {
  /** Immutable logical key for the leg (stable across hot-plug). */
  id: string;
  name?: string | null;
  /** Device path, capture URL, or a bare device-class hint. */
  source: string;
  /** Transport role (`primary` → the `main` stream; `ir` / `eo_wide` / …). */
  role?: string | null;
  /** Consumer purposes; always present (empty for an unassigned device). */
  purpose: string[];
  orientation?: string | null;
  enabled: boolean;
  /** `operator` (or absent) for an operator-managed leg; a plugin id when a
   * plugin owns it (the row renders read-only). */
  owner?: string | null;
  state: RosterCameraState;
  /** Agent-sampled liveness: `true` live, `false` known-dead, `null` unsampled. */
  live?: boolean | null;
  device_path?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  codec?: string | null;
  /** Transmit bitrate in kbps for this leg's encoder. The agent leg schema
   * carries a real value (not an option), so the roster GET reports it and the
   * operator write must round-trip it or the agent resets it to the compiled
   * default. */
  bitrate_kbps?: number | null;
  /** Opaque per-leg calibration payload the agent round-trips verbatim (camera
   * intrinsics / distortion blob). Carried through untouched. */
  calibration?: string | null;
  match?: CameraFingerprint | null;
  fov_deg?: number | null;
  mount_pitch_deg?: number | null;
}

/** One leg in the `PUT /api/video/roster` body. The operator write is a full
 * declared-leg list; the agent stamps the owner and merges by owner so plugin
 * legs are preserved. Only `id` + `source` are required. */
export interface CameraLegInput {
  id: string;
  source: string;
  role?: string | null;
  orientation?: string | null;
  purpose?: string[];
  enabled?: boolean;
  name?: string | null;
  codec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  bitrate_kbps?: number | null;
  /** Opaque per-leg calibration payload preserved across a write so the agent
   * keeps the leg's calibration instead of dropping it. */
  calibration?: string | null;
  fov_deg?: number | null;
  mount_pitch_deg?: number | null;
  match?: CameraFingerprint | null;
}

export interface ComputeCapability {
  npu_available: boolean;
  npu_runtime: "rknn" | "tensorrt" | "tflite" | "opencv_dnn" | null;
  npu_tops: number;
  npu_utilization_pct: number;
  gpu_available: boolean;
}

export interface VisionState {
  engine_state: "off" | "initializing" | "ready" | "active" | "degraded" | "error";
  active_behavior: string | null;
  behavior_state: "idle" | "designating" | "searching" | "tracking" | "executing" | "paused" | null;
  fps: number;
  inference_ms: number;
  model_loaded: string | null;
  track_count: number;
  target_locked: boolean;
  target_confidence: number;
  obstacle_mode: "off" | "brake" | "detour";
  nearest_obstacle_m: number | null;
  threat_level: "green" | "yellow" | "red";
  error_message?: string;
}

export interface InstalledModel {
  id: string;
  variant: string;
  format: string;
  size_mb: number;
  loaded: boolean;
}

/**
 * Compact live-detection summary the agent forwards every heartbeat
 * when the vision engine is running a detection model. Distinct from
 * the richer `VisionState` block: this is the at-a-glance throughput
 * the drone-detail Vision tab shows without subscribing to a frame or
 * detection stream. All fields optional so an agent that predates the
 * vision surface leaves the whole block undefined.
 */
export interface VisionSummary {
  /** Active model id the engine has loaded, or null when idle. */
  activeModel?: string | null;
  /** Inference backend in use: "ort" | "rknn" | "mock". Free-form so a
   * future agent can advertise another backend without a GCS release. */
  backend?: string | null;
  /** Rolling detections-per-second the engine is publishing. */
  detectionsPerSec?: number;
  /** Vision pipeline frames-per-second (post-inference). */
  fps?: number;
}

export interface ModelCacheInfo {
  installed: InstalledModel[];
  cache_used_mb: number;
  cache_max_mb: number;
  registry_url: string;
}

/**
 * Local panel attached to the companion board over the 40-pin
 * expansion header (e.g. a 3.5" SPI LCD on a Cubie A7Z or Rock 5C
 * ground station). The agent reports this as a peripheral with
 * category="display"; infer-capabilities maps it to this shape so
 * the Hardware tab can render a status card and the drone card can
 * show an "LCD" pill next to the role badge.
 *
 * The live-state fields (touchCalibrated, activePage, lastTouchAt,
 * lastGesture, snapshotUrl) are populated from top-level heartbeat
 * keys, not from the peripheral's extra blob, so they refresh every
 * heartbeat without depending on a peripheral re-enumeration.
 */
export type LcdGesture = "tap" | "long_press" | "swipe" | "drag";

export interface AttachedDisplay {
  type: "spi-lcd" | "hdmi" | "none";
  controller?: string;
  hasTouch?: boolean;
  resolution?: string;
  rotation?: number;
  /** True once the touch panel has been calibrated against the
   * current rotation. Reflected in the agent's persistent display
   * config. Undefined for legacy heartbeats. */
  touchCalibrated?: boolean;
  /** Currently rendered page on the local LCD. Free-form string so
   * a future agent can add new pages without a GCS-side enum bump.
   * Examples: "dashboard" | "video" | "settings" | "more" |
   * "details.radio_link". */
  activePage?: string;
  /** Epoch milliseconds of the most recent touch event the agent
   * processed. Used by the Display sub-view to surface "last touch
   * Xs ago" without polling a separate endpoint. */
  lastTouchAt?: number;
  /** Most recent gesture the agent's touch input bridge classified.
   * "tap" / "long_press" / "swipe" / "drag" matches the agent
   * gesture taxonomy; anything else falls through as undefined. */
  lastGesture?: LcdGesture;
  /** Absolute URL to the agent's display snapshot endpoint. Returns
   * a PNG of the current framebuffer when polled. Lets the GCS show
   * a thumbnail without holding a video stream open. */
  snapshotUrl?: string;
}

/**
 * Snapshot of the agent's local-display video appsink tap. When the
 * companion board is rendering video to a bound LCD, the agent's
 * GStreamer pipeline forks a low-FPS appsink whose state we surface
 * here so the GCS can show "decoding via mppvideodec at 30 fps" in
 * the Hardware tab and the Video sub-view.
 */
export interface VideoLocalTap {
  /** True when the local appsink is producing frames. False when
   * the pipeline has paused the local tap (e.g. video recording is
   * the only active sink, or the LCD is off). Undefined for legacy
   * heartbeats that predate the local tap. */
  active?: boolean;
  /** Hardware decoder element name in the agent's pipeline.
   * Examples: "mppvideodec" (Rockchip), "v4l2h264dec" (Pi),
   * "avdec_h264" (software fallback). */
  decoderType?: string;
  /** Frames per second the local appsink is emitting. Used as the
   * refresh metric in the Hardware tab. */
  fps?: number;
}

/**
 * Camera + vision navigation capability the agent advertises every
 * heartbeat when the optical flow / VIO surfaces are wired. Lets the
 * GCS render the fleet "GPS-denied" pill, the pre-arm vision row, and
 * the Vision Navigation tab without having to poll a separate
 * endpoint. All inner fields are optional except the four required
 * shape keys so future agents can add metrics additively without
 * breaking older parsers.
 *
 * `rangefinderTopology` documents which side owns the downward
 * rangefinder feeding the flow / VIO solver:
 *   - "companion" — the companion computer owns the sensor and feeds
 *     the FC the resulting RNGFND distance.
 *   - "fc"        — the FC owns the rangefinder directly.
 *   - "both"      — sensors on both sides; cross-check available.
 *   - null        — no downward rangefinder is wired.
 *
 * `recommendedCameraId` matches the camera the agent's vision pipeline
 * picked for flow / VIO ingest, or null when the operator has not yet
 * chosen one.
 */
export interface NavigationCapability {
  opticalFlowSupported: boolean;
  vioSupported: boolean;
  rangefinderTopology: "companion" | "fc" | "both" | null;
  recommendedCameraId: string | null;
  flowQuality?: number;
  flowRateHz?: number;
  flowDistanceM?: number | null;
  /** Examples: "active" | "degraded" | "lost" | "absent". Free-form so
   * a future agent can add new states without a GCS-side enum bump. */
  vioState?: string;
  vioResetCounter?: number;
  vioQuality?: number;
  /** Examples: "active" | "critical" | "terminating" | "absent".
   * Mirrors the agent-side companion supervisor state. */
  companionState?: string;
  /** Currently-selected estimator key. Mirrors the agent ``mode`` config
   * field. Values today: "off" | "optical_flow". Future phases add
   * "optical_flow_degraded" | "vio_openvins" | "vio_vins_fusion" |
   * "hybrid_of_plus_vio". Free-form so the GCS does not need a new
   * release every time the agent adds an estimator. */
  mode?: string;
  /** Estimator keys the running plugin instance can actually
   * instantiate. The mode picker only shows options in this list, so
   * an operator never sees an estimator the agent cannot run on the
   * detected hardware. */
  availableEstimators?: string[];
  /** Estimator state machine. Mirrors the BaseEstimator contract on
   * the agent side. Values: "off" | "init" | "converging" |
   * "converged" | "degraded" | "failed". */
  estimatorState?: string;
  /** Where the OF scale comes from when the active estimator is an
   * optical-flow variant. Values: "rangefinder" | "baro" | "gps" |
   * "vision" | null. Null when the estimator does not produce flow
   * (the VIO and off cases). */
  flowScaleSource?: "rangefinder" | "baro" | "gps" | "vision" | null;
  /** Number of features the VIO estimator is currently tracking. Null
   * when no VIO is active. */
  estimatorFeatureCount?: number;
  /** Estimator drift estimate in metres over a sliding window. Null
   * when not yet computable or for non-VIO estimators. */
  estimatorDriftEstimateM?: number;
  /** IMU source the estimator is reading. Values: "mavlink-raw-imu" |
   * "mavlink-scaled-imu2" | "direct-i2c" | "direct-dronecan". */
  imuSource?: string;
  /** IMU sample rate in Hz. Today this is whatever the FC publishes
   * RAW_IMU at, typically 50 to 200 Hz. A direct DroneCAN or I2C
   * path will lift this once the estimator framework wires it. */
  imuRateHz?: number;
  /** Whether camera intrinsics have been loaded. Used to gate the VIO
   * pre-arm check. */
  cameraIntrinsicsLoaded?: boolean;
  /** Estimated camera↔IMU time-sync offset in milliseconds. Yellow gate
   * at ±5 ms, red gate at ±15 ms in the GCS sensors card. */
  cameraImuSyncOffsetMs?: number;
}

/**
 * One CAN bus entry as the agent reports it from the persisted FC
 * parameter cache. ``port`` matches the FC's ``CAN_Pn_*`` parameter
 * suffix (1 or 2). ``driver`` is the ``CAN_Pn_DRIVER`` slot (0 means
 * the port is disabled). ``bitrate`` is the FC-configured bus speed
 * in bits per second. ``protocol`` is the ``CAN_Dn_PROTOCOL``
 * selection (1 = DroneCAN; vendor-specific otherwise). Mission
 * Control surfaces this on the drone card so an operator can see
 * the per-port CAN configuration without opening the FC parameter
 * panel. Future agent revisions may add fields (frame error counts,
 * bus utilization); the GCS treats unknown fields as a forward-
 * compatible no-op.
 */
export interface CanBusInfo {
  port: number;
  driver: number;
  bitrate: number;
  protocol: number;
}

/** One network adapter's stable-MAC verdict, reported by the agent when an
 * onboard adapter has no efuse MAC and randomizes its address each boot. */
export interface MacStabilityAdapter {
  name?: string;
  /** "vvvv:pppp" USB id. */
  vidpid?: string;
  usbPath?: string;
  /** "stable" (efuse, left alone) | "pinned" (a stable MAC was set for next
   * boot) | "candidate" (learner suspects randomization, awaiting confirm) |
   * "deferred" (can't pin yet) | "disabled" (pinning off). */
  state?: "stable" | "pinned" | "candidate" | "deferred" | "disabled";
  source?: "quirk" | "learned" | "override";
  pinnedMac?: string;
  lastSeenMac?: string;
  appliedLive?: boolean;
  linkFile?: string;
  deferredReason?: string;
}

/** Per-adapter stable-MAC pin verdicts. Absent on boards with no no-efuse
 * randomizer; lets the Network panel show the operator that the agent handled
 * the IP-churn and surface the pinned MAC for a DHCP reservation. */
export interface MacStability {
  version?: number;
  adapters: MacStabilityAdapter[];
}

/** One WiFi interface's power-save reconciler verdict, reported by the agent's
 * runtime reconciler that holds power-save OFF. Power-save adds receive latency
 * and drops throughput on a link that must stay responsive, so `powersaveOn`
 * reads false on a healthy interface; a true reading means the reconciler has
 * not yet re-asserted it back off. */
export interface WifiPowersaveInterface {
  iface: string;
  /** True when power-save is currently ON (undesired); a healthy interface
   * reads false because the reconciler holds it off. */
  powersaveOn: boolean;
  /** How many times the reconciler has had to re-assert power-save OFF on this
   * interface. A climbing count means the driver keeps flipping it back on. */
  reasserts: number;
  /** ISO-8601 timestamp of the last re-assert, or null when it has never had
   * to intervene. */
  lastReassert: string | null;
  /** Current link signal in dBm (negative), or null when unknown. */
  signalDbm: number | null;
  /** The interface's link state as the agent sees it (e.g. "connected"). */
  linkState: string;
}

/** Per-interface WiFi power-save reconciler verdicts. Absent on agents that
 * predate the reconciler, or on profiles with no managed WiFi interface. Lets
 * the Network panel prove power-save is held OFF at runtime and surface the
 * re-assert count + signal per interface. */
export interface WifiPowersave {
  interfaces: WifiPowersaveInterface[];
}

/** Operator management-link health, from the agent's management-link guardian.
 * Absent on agents that predate the guardian. A "degraded" link is up but
 * passing no traffic (gateway unreachable) — rendered distinctly from healthy. */
export interface ManagementLink {
  /** "healthy" | "degraded" (up, no data path) | "down" | "unknown". */
  state: "healthy" | "degraded" | "down" | "unknown";
  /** The interface carrying the management link (e.g. "eth0", "wlan0"). */
  iface?: string;
  transport?: "ethernet" | "wifi";
  backend?: "networkmanager" | "networkd" | "fallback";
  carrier?: boolean;
  hasLease?: boolean;
  gatewayReachable?: boolean;
  /** True when the guardian is actively walking the repair ladder. */
  repairing?: boolean;
  /** The last repair rung attempted: "reassert_reg" | "renew_dhcp" |
   * "reconnect_wifi" | "bounce_iface" | "restart_backend" | "exhausted". */
  lastRung?: string;
  lastRepairAt?: number | null;
  repairsInWindow?: number;
}

export interface AgentCapabilities {
  tier: number;
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
  /** Optional. Previous MAVLink WebSocket URL the agent advertised.
   * Populated when the agent rotates its WebSocket binding. Lets the
   * GCS retry the prior URL once before surfacing a connection error
   * so a brief rotation doesn't drop an in-flight session. */
  mavlinkWsUrlPrev?: string | null;
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
   * port_cycling / hub_resetting / needs_hub_reset / guard_blocked /
   * exhausted). Lets the GCS show a self-heal in flight, or a camera
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
   * "idle" | "rehoming" (unbind/rebind in progress) | "exhausted" (gave up
   * after the attempt budget) | "guard_blocked" (held back to protect the
   * management link). Undefined on agents that predate the self-heal. */
  usbRehomeState?: "idle" | "rehoming" | "exhausted" | "guard_blocked";
  /** Rehome attempts in the current episode. */
  usbRehomeAttempts?: number | null;
  /** The last rehome outcome (e.g. "success", "retry", "exhausted"). */
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
   *   - "hybrid" — a mix of local and offloaded pipelines.
   *   - "none"   — no perception is running / no path available.
   * Undefined on agents that predate the tier signal; an unrecognized value
   * normalizes to undefined so the surface reads "unknown" rather than a
   * fabricated tier. */
  perceptionTier?: "local" | "offload" | "hybrid" | "none";
  /** The workstation node the agent offloads perception to (a device id /
   * host), or null when it runs locally or has no target. Undefined on agents
   * that predate the field. */
  perceptionOffloadTarget?: string | null;
}

// ── Model Registry (from registry.json) ──────────────────

export interface ModelVariantFormat {
  url: string;
  size_mb: number;
  sha256: string;
}

export interface ModelVariant {
  variant: string;
  input_size: string;
  min_tops: number;
  formats: Record<string, ModelVariantFormat>;
}

export interface RegistryModel {
  id: string;
  name: string;
  description: string;
  license: string;
  classes: string[];
  variants: ModelVariant[];
}

export interface ModelRegistry {
  version: number;
  models: RegistryModel[];
}

export interface ModelDownloadStatus {
  model_id: string;
  state: "idle" | "downloading" | "verifying" | "complete" | "error";
  progress: number;
  error?: string;
}
