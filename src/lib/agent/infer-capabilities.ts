/**
 * @module InferCapabilities
 * @description Builds the agent capability snapshot from the agent's status
 * and peripherals list. Compute capability (NPU throughput and accelerator
 * presence) comes from the values the agent declares on its status and
 * heartbeat; cameras come from the peripherals list.
 * @license GPL-3.0-only
 */

import type { AgentStatus, PeripheralInfo } from "@/lib/agent/types";
import type {
  AgentCapabilities,
  AttachedDisplay,
  CameraCapability,
  ComputeCapability,
  LcdGesture,
  NavigationCapability,
  VideoLocalTap,
} from "./feature-types";

/**
 * Top-level heartbeat fields the cloud bridge passes through when
 * inferring capabilities. These are flat keys on the cloud row, not
 * nested under a peripheral, so they refresh every heartbeat without
 * waiting for a peripheral re-enumeration. All keys optional —
 * legacy agents that predate any one of them simply omit the field
 * and the inferred capability stays undefined.
 */
export interface InferHeartbeatExtras {
  lcdActivePage?: string | null;
  lcdTouchCalibrated?: boolean | null;
  lcdRotation?: number | null;
  lcdSnapshotUrl?: string | null;
  lcdLastTouchAt?: number | null;
  lcdLastGesture?: string | null;
  videoLocalDecoderActive?: boolean | null;
  videoLocalDecoderType?: string | null;
  videoLocalDecoderFps?: number | null;
  videoRecording?: boolean | null;
  uiTheme?: string | null;
  /** Effective primary local-display path resolved by the agent for
   * the current heartbeat. One of "hdmi" | "lcd" | "none"; "auto" is
   * accepted as well so a config-echo path stays in-band. Undefined
   * on agents that predate the enrichment. */
  displayType?: string | null;
  /** Camera + vision navigation block the agent forwards every
   * heartbeat when the optical flow / VIO surfaces are wired. Passed
   * through to the capability store as-is; the inference path does
   * not fabricate this from board / peripheral signals alone.
   * Undefined for legacy heartbeats. Typed as `unknown` because the
   * heartbeat shape is validated by the store-side schema, not here. */
  navigation?: unknown;
  /** Active vision model id the engine has loaded, or null when idle.
   * Forwarded each heartbeat once the agent wires the vision surface.
   * Its presence (string or null) is itself the signal that the agent
   * supports the vision engine, so the inference path uses it to set
   * `visionAvailable` even when the value is null (engine present but
   * idle). Undefined for agents that predate the surface. */
  visionActiveModel?: string | null;
  /** Inference backend the vision engine is using ("ort" | "rknn" |
   * "mock"), or null. Like visionActiveModel, its presence advertises
   * that the agent supports the vision engine. */
  visionBackend?: string | null;
  /** Rolling detections-per-second the vision engine is publishing. */
  visionDetectionsPerSec?: number | null;
  /** Vision pipeline frames-per-second (post-inference). */
  visionFps?: number | null;
  /** NPU throughput the agent declares for its board, in TOPS (0 when the
   * board has none). The authoritative compute source; undefined when the
   * producer omitted it. */
  npuTops?: number | null;
  /** The agent's own declaration that the board carries NPU hardware. */
  hasAccelerator?: boolean | null;
}

const KNOWN_RANGEFINDER_TOPOLOGIES: ReadonlySet<
  NonNullable<NavigationCapability["rangefinderTopology"]>
> = new Set(["companion", "fc", "both"]);

/**
 * Coerce a raw heartbeat `navigation` block to a typed
 * NavigationCapability or return undefined when the block is missing
 * or fails the minimum-shape check. Required fields:
 *   - opticalFlowSupported (boolean)
 *   - vioSupported (boolean)
 *   - rangefinderTopology ("companion" | "fc" | "both" | null)
 *   - recommendedCameraId (string | null)
 * Optional metric fields pass through when their type matches; an
 * unknown vioState / companionState string passes through verbatim
 * because the agent owns the state vocabulary.
 */
function normalizeNavigation(raw: unknown): NavigationCapability | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const n = raw as Record<string, unknown>;
  if (
    typeof n.opticalFlowSupported !== "boolean" ||
    typeof n.vioSupported !== "boolean"
  ) {
    return undefined;
  }
  const rangefinderRaw = n.rangefinderTopology;
  const rangefinderTopology: NavigationCapability["rangefinderTopology"] =
    rangefinderRaw === null
      ? null
      : typeof rangefinderRaw === "string" &&
          KNOWN_RANGEFINDER_TOPOLOGIES.has(
            rangefinderRaw as NonNullable<
              NavigationCapability["rangefinderTopology"]
            >,
          )
        ? (rangefinderRaw as NonNullable<
            NavigationCapability["rangefinderTopology"]
          >)
        : null;
  const recommendedCameraIdRaw = n.recommendedCameraId;
  const recommendedCameraId: string | null =
    typeof recommendedCameraIdRaw === "string"
      ? recommendedCameraIdRaw
      : null;
  const nav: NavigationCapability = {
    opticalFlowSupported: n.opticalFlowSupported,
    vioSupported: n.vioSupported,
    rangefinderTopology,
    recommendedCameraId,
  };
  if (typeof n.flowQuality === "number") nav.flowQuality = n.flowQuality;
  if (typeof n.flowRateHz === "number") nav.flowRateHz = n.flowRateHz;
  if (typeof n.flowDistanceM === "number") {
    nav.flowDistanceM = n.flowDistanceM;
  } else if (n.flowDistanceM === null) {
    nav.flowDistanceM = null;
  }
  if (typeof n.vioState === "string") nav.vioState = n.vioState;
  if (typeof n.vioResetCounter === "number") {
    nav.vioResetCounter = n.vioResetCounter;
  }
  if (typeof n.vioQuality === "number") nav.vioQuality = n.vioQuality;
  if (typeof n.companionState === "string") {
    nav.companionState = n.companionState;
  }
  // Additive fields from the estimator-framework heartbeat. All
  // optional on the wire: an older agent that does not emit them
  // leaves the GCS rendering the legacy single-mode card, which is
  // exactly what we want during a rolling upgrade.
  if (typeof n.mode === "string") nav.mode = n.mode;
  if (Array.isArray(n.availableEstimators)) {
    const keys = n.availableEstimators.filter(
      (entry): entry is string => typeof entry === "string",
    );
    nav.availableEstimators = keys;
  }
  if (typeof n.estimatorState === "string") {
    nav.estimatorState = n.estimatorState;
  }
  const scaleRaw = n.flowScaleSource;
  if (scaleRaw === null) {
    nav.flowScaleSource = null;
  } else if (
    typeof scaleRaw === "string" &&
    (scaleRaw === "rangefinder" ||
      scaleRaw === "baro" ||
      scaleRaw === "gps" ||
      scaleRaw === "vision")
  ) {
    nav.flowScaleSource = scaleRaw;
  }
  if (typeof n.estimatorFeatureCount === "number") {
    nav.estimatorFeatureCount = n.estimatorFeatureCount;
  }
  if (typeof n.estimatorDriftEstimateM === "number") {
    nav.estimatorDriftEstimateM = n.estimatorDriftEstimateM;
  }
  if (typeof n.imuSource === "string") nav.imuSource = n.imuSource;
  if (typeof n.imuRateHz === "number") nav.imuRateHz = n.imuRateHz;
  if (typeof n.cameraIntrinsicsLoaded === "boolean") {
    nav.cameraIntrinsicsLoaded = n.cameraIntrinsicsLoaded;
  }
  if (typeof n.cameraImuSyncOffsetMs === "number") {
    nav.cameraImuSyncOffsetMs = n.cameraImuSyncOffsetMs;
  }
  return nav;
}

const KNOWN_GESTURES: ReadonlySet<LcdGesture> = new Set([
  "tap",
  "long_press",
  "swipe",
  "drag",
]);

/**
 * The inference runtime family for an NPU the agent declared, recognised from
 * the SoC family name. Null when the agent declared no NPU, or when the
 * silicon family has no known runtime.
 */
function npuRuntimeFor(
  soc: string,
  npuTops: number,
): ComputeCapability["npu_runtime"] {
  if (npuTops <= 0) return null;
  const family = soc.toUpperCase();
  if (/^R[KV]\d/.test(family)) return "rknn";
  if (/TEGRA|JETSON|ORIN/.test(family)) return "tensorrt";
  return null;
}

/**
 * Build capabilities from agent status + peripherals.
 *
 * The optional `heartbeatExtras` argument carries top-level fields the agent
 * reports on every status or heartbeat (declared NPU throughput, LCD live
 * state, local video tap, recording flag, UI theme). Each field is read
 * defensively and independently: any one being absent leaves the matching
 * capability undefined, and an undeclared NPU reads as none.
 */
export function inferCapabilities(
  status: AgentStatus | null,
  peripherals: PeripheralInfo[],
  heartbeatExtras?: InferHeartbeatExtras,
  profile?: string,
): AgentCapabilities | null {
  if (!status) return null;

  const board = status.board;
  if (!board) return null;

  // A workstation (Mac / Win / Linux box) runs a GPU, not a tiered SBC NPU, and
  // is not on the board "tier" ladder; surface that it is GPU-capable. The live
  // GPU identity + utilisation come from the compute-status poll (compute
  // store), not from the heartbeat board.
  const isWorkstation = profile === "workstation";
  const extras = heartbeatExtras ?? {};

  // The agent's declaration is the only source of NPU capability: it reads
  // the board profile it actually booted on.
  const npuTops =
    typeof extras.npuTops === "number" && Number.isFinite(extras.npuTops)
      ? extras.npuTops
      : 0;
  const npuAvailable =
    typeof extras.hasAccelerator === "boolean"
      ? extras.hasAccelerator
      : npuTops > 0;

  const compute: ComputeCapability = {
    npu_available: npuAvailable,
    npu_runtime: npuAvailable ? npuRuntimeFor(board.soc ?? "", npuTops) : null,
    npu_tops: npuTops,
    npu_utilization_pct: null,
    gpu_available: isWorkstation,
  };

  // Infer cameras from peripherals
  const cameras: CameraCapability[] = peripherals
    .filter((p) => p.category === "camera")
    .map((p) => ({
      name: p.name,
      type: "usb" as const,
      device: p.address,
      resolution: p.last_reading?.match(/\d+x\d+/)?.[0] ?? "unknown",
      // Peripheral health says the device enumerates, not that it is being
      // encoded or published.
      streaming: null,
    }));

  // Infer attached display (SPI LCD) from peripherals. The agent
  // pushes one peripheral with category="display" per /etc/ados/display.conf
  // entry; phase-1 only ships SPI LCDs but the type field stays open
  // so a future HDMI / DPI panel reuses the same surface.
  // Live-state fields (touchCalibrated, activePage, lastTouchAt,
  // lastGesture, snapshotUrl) come from the heartbeat top-level keys
  // so they refresh every tick. Rotation can come from either source;
  // the heartbeat wins because it's authoritative for the current
  // running state (peripheral.extra.rotation reflects only what
  // /etc/ados/display.conf had at boot).
  const heartbeatGestureRaw =
    typeof extras.lcdLastGesture === "string"
      ? extras.lcdLastGesture
      : undefined;
  const lastGesture: LcdGesture | undefined =
    heartbeatGestureRaw && KNOWN_GESTURES.has(heartbeatGestureRaw as LcdGesture)
      ? (heartbeatGestureRaw as LcdGesture)
      : undefined;

  const displayPeripheral = peripherals.find((p) => p.category === "display");
  const display: AttachedDisplay | undefined = displayPeripheral
    ? {
        type: (displayPeripheral.type as AttachedDisplay["type"]) ?? "spi-lcd",
        controller:
          (displayPeripheral.extra?.controller as string | undefined) ?? undefined,
        hasTouch:
          (displayPeripheral.extra?.has_touch as boolean | undefined) ?? false,
        resolution:
          (displayPeripheral.extra?.resolution as string | undefined) ?? undefined,
        rotation:
          typeof extras.lcdRotation === "number"
            ? extras.lcdRotation
            : (displayPeripheral.extra?.rotation as number | undefined) ?? undefined,
        touchCalibrated:
          typeof extras.lcdTouchCalibrated === "boolean"
            ? extras.lcdTouchCalibrated
            : undefined,
        activePage:
          typeof extras.lcdActivePage === "string"
            ? extras.lcdActivePage
            : undefined,
        lastTouchAt:
          typeof extras.lcdLastTouchAt === "number"
            ? extras.lcdLastTouchAt
            : undefined,
        lastGesture,
        snapshotUrl:
          typeof extras.lcdSnapshotUrl === "string"
            ? extras.lcdSnapshotUrl
            : undefined,
      }
    : undefined;

  // Local video tap snapshot. The agent toggles `active` independent
  // of the decoder type and fps fields, so we surface the block as a
  // whole whenever any of the three keys is present (including
  // `active=false` so the GCS can render "tap paused" instead of
  // disappearing the card).
  const hasVideoLocalTap =
    typeof extras.videoLocalDecoderActive === "boolean" ||
    typeof extras.videoLocalDecoderType === "string" ||
    typeof extras.videoLocalDecoderFps === "number";
  const videoLocalTap: VideoLocalTap | undefined = hasVideoLocalTap
    ? {
        active:
          typeof extras.videoLocalDecoderActive === "boolean"
            ? extras.videoLocalDecoderActive
            : undefined,
        decoderType:
          typeof extras.videoLocalDecoderType === "string"
            ? extras.videoLocalDecoderType
            : undefined,
        fps:
          typeof extras.videoLocalDecoderFps === "number"
            ? extras.videoLocalDecoderFps
            : undefined,
      }
    : undefined;

  const videoRecording =
    typeof extras.videoRecording === "boolean" ? extras.videoRecording : undefined;

  const uiTheme: "dark" | "light" | undefined =
    extras.uiTheme === "dark" || extras.uiTheme === "light"
      ? extras.uiTheme
      : undefined;

  // Effective primary local-display path. Accept the four known
  // values ("auto" / "hdmi" / "lcd" / "none") + null; anything else
  // falls through as undefined so a stale or future-shape value can't
  // pin the picker.
  const displayType: AgentCapabilities["displayType"] =
    extras.displayType === "auto" ||
    extras.displayType === "hdmi" ||
    extras.displayType === "lcd" ||
    extras.displayType === "none"
      ? extras.displayType
      : extras.displayType === null
        ? null
        : undefined;

  // Camera + vision navigation block. Pure passthrough from the
  // heartbeat — the inference path does not fabricate this from
  // board / peripheral signals because no current peripheral category
  // advertises optical flow / VIO support directly. When the agent
  // omits the block, the field stays undefined and downstream
  // selectors read it as such.
  const navigation = normalizeNavigation(extras.navigation);

  // Vision availability + live-detection summary.
  //
  // The agent advertises the vision surface by emitting `visionBackend`
  // / `visionActiveModel` on its heartbeat. Their presence (even as
  // null — engine present but idle) is the authoritative signal that
  // this drone can run the vision engine. When the agent does NOT
  // advertise the surface (older agent), we fall back to the board
  // signal: a real NPU (TOPS > 0) is the hardware prerequisite for
  // on-device inference, so a drone with a real NPU is treated as
  // vision-capable. A board with no NPU and no advertised surface
  // leaves the flag undefined so the tab stays hidden.
  const advertisesVision =
    extras.visionBackend !== undefined ||
    extras.visionActiveModel !== undefined;
  const visionAvailable: boolean | undefined = advertisesVision
    ? true
    : compute.npu_tops > 0
      ? true
      : undefined;

  const activeModel: string | null | undefined =
    typeof extras.visionActiveModel === "string"
      ? extras.visionActiveModel
      : extras.visionActiveModel === null
        ? null
        : undefined;
  const backend: string | null | undefined =
    typeof extras.visionBackend === "string"
      ? extras.visionBackend
      : extras.visionBackend === null
        ? null
        : undefined;
  const detectionsPerSec =
    typeof extras.visionDetectionsPerSec === "number" &&
    Number.isFinite(extras.visionDetectionsPerSec)
      ? extras.visionDetectionsPerSec
      : undefined;
  const visionFps =
    typeof extras.visionFps === "number" && Number.isFinite(extras.visionFps)
      ? extras.visionFps
      : undefined;
  const visionSummary = advertisesVision
    ? {
        activeModel,
        backend,
        detectionsPerSec,
        fps: visionFps,
      }
    : undefined;

  return {
    tier: board.tier,
    cameras,
    // Per-leg WHEP streams are advertised by the agent status/heartbeat, not
    // inferred from the board; empty here (the switcher falls back to cameras).
    videoStreams: [],
    compute,
    vision: {
      engine_state: "off",
      active_behavior: null,
      behavior_state: null,
      fps: 0,
      inference_ms: 0,
      model_loaded: null,
      track_count: 0,
      target_locked: false,
      target_confidence: 0,
      obstacle_mode: "off",
      nearest_obstacle_m: null,
      threat_level: "green",
    },
    models: {
      installed: [],
      cache_used_mb: 0,
      cache_max_mb: null,
      registry_url: "",
    },
    display,
    displayType,
    videoLocalTap,
    videoRecording,
    uiTheme,
    navigation,
    visionAvailable,
    visionSummary,
    // Accelerator posture the Perception hub reads for the tier rationale.
    // Inference cannot know the RESOLVED perceptionTier (an agent decision), so
    // that stays undefined here; the accelerator headroom it can derive.
    npuTops: compute.npu_tops,
    hasAccelerator: compute.npu_available || compute.gpu_available,
  };
}
