/**
 * @module AgentCapabilities/Normalizer
 * @description Maps the on-wire agent capabilities payload onto the GCS-side
 * TypeScript types. The agent has shipped several legacy shapes over time
 * (features as an array OR { enabled, active }, models as an array OR
 * { installed, cache_used_mb, ... }); the normalizer collapses those into a
 * single canonical shape the store can hold.
 *
 * Barrel over the per-concern modules, matching the `ground-station-store` /
 * `settings-store` pattern: the radio block (`./normalize-radio`), the CRSF
 * block (`./normalize-crsf`) and the neutral seed values
 * (`./normalize-defaults`) each change on their own schedule and are each
 * separately testable. Smaller forward-permissive per-field parsers live in
 * `./derivers`.
 *
 * Every helper here is a pure function: no Zustand access, no side effects.
 *
 * @license GPL-3.0-only
 */

import type {
  AgentCapabilities,
  CameraCapability,
  ComputeCapability,
  InstalledModel,
  ModelCacheInfo,
  NavigationCapability,
  VideoStreamLeg,
  VisionState,
} from "@/lib/agent/feature-types";
import { AgentCapabilitiesRawSchema } from "@/lib/agent/schemas";
import { normalizeCameraUsbRecovery } from "@/lib/agent/camera-recovery";
import {
  DEFAULT_COMPUTE,
  DEFAULT_MODELS,
  DEFAULT_VISION,
} from "./normalize-defaults";

export { DEFAULT_COMPUTE, DEFAULT_MODELS, DEFAULT_VISION } from "./normalize-defaults";
export { normalizeRadio } from "./normalize-radio";
export { normalizeCrsf } from "./normalize-crsf";

/**
 * Map a raw agent capabilities payload onto the GCS AgentCapabilities shape.
 * Failure (schema mismatch, non-object input) falls back to defaults so the
 * UI degrades gracefully instead of crashing on a single bad heartbeat.
 */
export function normalizeCapabilities(raw: unknown): AgentCapabilities {
  // Run the payload through the schema. Schemas are permissive
  // (passthrough + optional everywhere) so this validates shape but
  // does not reject unknown fields. Failure falls back to defaults.
  const parsed = AgentCapabilitiesRawSchema.safeParse(raw);
  if (!parsed.success || !raw || typeof raw !== "object") {
    return {
      tier: 0,
      cameras: [],
      videoStreams: [],
      compute: DEFAULT_COMPUTE,
      vision: DEFAULT_VISION,
      models: DEFAULT_MODELS,
    };
  }
  const data = parsed.data;

  // Normalize compute: infer npu_available from npu_tops > 0
  const rawCompute = data.compute ?? {};
  const npuTops = Number(rawCompute.npu_tops ?? 0);
  const compute: ComputeCapability = {
    npu_available: rawCompute.npu_available ?? npuTops > 0,
    npu_runtime: rawCompute.npu_runtime ?? null,
    npu_tops: npuTops,
    npu_utilization_pct: Number(rawCompute.npu_utilization_pct ?? 0),
    gpu_available: Boolean(rawCompute.gpu_available ?? false),
  };

  // Normalize cameras: default streaming to true, type to "usb"
  const cameras: CameraCapability[] = (data.cameras ?? []).map((c) => ({
    name: c.name ?? "Unknown Camera",
    type: (c.type as CameraCapability["type"]) ?? "usb",
    device: c.device,
    resolution: c.resolution ?? "unknown",
    fps: c.fps,
    streaming: c.streaming ?? true, // Agent-detected cameras are streaming
  }));

  // Per-leg video streams: pass through the host-resolved legs the producer
  // (status/heartbeat) folded in. Only legs with an id + a resolved whepUrl are
  // usable by the switcher.
  const videoStreams: VideoStreamLeg[] = (data.videoStreams ?? [])
    .filter((s) => s.id && s.whepUrl)
    .map((s) => ({
      id: s.id,
      role: s.role ?? undefined,
      codec: s.codec ?? undefined,
      whepUrl: s.whepUrl,
    }));

  // Normalize vision: merge with defaults
  const vision: VisionState = { ...DEFAULT_VISION };
  if (data.vision) {
    const v = data.vision;
    if (v.engine_state) vision.engine_state = v.engine_state;
    if (v.active_behavior !== undefined) vision.active_behavior = v.active_behavior;
    if (v.behavior_state !== undefined) vision.behavior_state = v.behavior_state;
    if (typeof v.fps === "number") vision.fps = v.fps;
    if (typeof v.inference_ms === "number") vision.inference_ms = v.inference_ms;
    if (v.model_loaded !== undefined) vision.model_loaded = v.model_loaded;
    if (typeof v.track_count === "number") vision.track_count = v.track_count;
    if (typeof v.target_locked === "boolean") vision.target_locked = v.target_locked;
    if (typeof v.target_confidence === "number") vision.target_confidence = v.target_confidence;
    if (v.obstacle_mode) vision.obstacle_mode = v.obstacle_mode;
    if (v.nearest_obstacle_m !== undefined && v.nearest_obstacle_m !== null) {
      vision.nearest_obstacle_m = v.nearest_obstacle_m;
    }
    if (v.threat_level) vision.threat_level = v.threat_level;
    // Also check the agent's vision.enabled field (agent shape)
    if (v.enabled === true && vision.engine_state === "off") {
      vision.engine_state = "ready";
    }
  }

  // Normalize models
  const rawModels = data.models;
  let installed: InstalledModel[] = [];
  let cacheUsedMb = 0;
  let cacheMaxMb = 500;
  let registryUrl = "";
  if (Array.isArray(rawModels)) {
    installed = rawModels as InstalledModel[];
  } else if (rawModels) {
    installed = (rawModels.installed ?? []) as InstalledModel[];
    cacheUsedMb = rawModels.cache_used_mb ?? 0;
    cacheMaxMb = rawModels.cache_max_mb ?? 500;
    registryUrl = rawModels.registry_url ?? "";
  }
  const models: ModelCacheInfo = {
    installed,
    cache_used_mb: cacheUsedMb,
    cache_max_mb: cacheMaxMb,
    registry_url: registryUrl,
  };

  // Pass-through: pre-inferred display block from infer-capabilities or
  // a future agent capabilities API field. The Zod raw schema is
  // forward-permissive, so we read the field directly off the input.
  const displayCandidate = (raw as { display?: unknown }).display;
  const display =
    displayCandidate && typeof displayCandidate === "object"
      ? (displayCandidate as AgentCapabilities["display"])
      : undefined;

  // Pass-through: effective primary local-display path. Agent emits
  // one of "hdmi" | "lcd" | "none" each heartbeat; "auto" is accepted
  // as well so a future config-echo payload that carries the
  // unresolved override still surfaces cleanly. Anything else is
  // treated as absent so a stale string can't pin the picker.
  const displayTypeCandidate = (raw as { displayType?: unknown }).displayType;
  const displayType: AgentCapabilities["displayType"] =
    displayTypeCandidate === "auto" ||
    displayTypeCandidate === "hdmi" ||
    displayTypeCandidate === "lcd" ||
    displayTypeCandidate === "none"
      ? displayTypeCandidate
      : displayTypeCandidate === null
        ? null
        : undefined;

  // Pass-through: local video tap state. infer-capabilities builds
  // this block from the heartbeat top-level keys; an agent that
  // ships a /api/capabilities surface in the future can also
  // populate it directly.
  const videoLocalTapCandidate = (raw as { videoLocalTap?: unknown })
    .videoLocalTap;
  const videoLocalTap =
    videoLocalTapCandidate && typeof videoLocalTapCandidate === "object"
      ? (videoLocalTapCandidate as AgentCapabilities["videoLocalTap"])
      : undefined;

  const videoRecordingCandidate = (raw as { videoRecording?: unknown })
    .videoRecording;
  const videoRecording =
    typeof videoRecordingCandidate === "boolean"
      ? videoRecordingCandidate
      : undefined;

  const uiThemeCandidate = (raw as { uiTheme?: unknown }).uiTheme;
  const uiTheme: AgentCapabilities["uiTheme"] =
    uiThemeCandidate === "dark" || uiThemeCandidate === "light"
      ? uiThemeCandidate
      : undefined;

  // Pass-through: agent runtime mode. The agent emits "native" |
  // "hybrid" | "packaged" once it reports the runtime surface; anything
  // else (absent field, future variant, non-string) normalizes to
  // undefined so a legacy heartbeat round-trips cleanly and the badge
  // stays hidden until a known value arrives.
  const runtimeModeCandidate = (raw as { runtimeMode?: unknown }).runtimeMode;
  const runtimeMode: AgentCapabilities["runtimeMode"] =
    runtimeModeCandidate === "native" ||
    runtimeModeCandidate === "hybrid" ||
    runtimeModeCandidate === "packaged"
      ? runtimeModeCandidate
      : undefined;

  // Pass-through: overall radio-stack health. The agent emits one of
  // the known states once it reports the radio-stack surface; anything
  // else (absent field, future variant, non-string) normalizes to
  // undefined so a legacy heartbeat round-trips cleanly and the
  // diagnostic line stays hidden until a known value arrives.
  const radioStackStateCandidate = (raw as { radioStackState?: unknown })
    .radioStackState;
  const radioStackState: AgentCapabilities["radioStackState"] =
    radioStackStateCandidate === "ok" ||
    radioStackStateCandidate === "no_injection" ||
    radioStackStateCandidate === "unpaired" ||
    radioStackStateCandidate === "no_bind_artifacts" ||
    radioStackStateCandidate === "stack_incomplete"
      ? radioStackStateCandidate
      : undefined;

  // Stable-MAC pin verdicts: a forward-permissive object pass-through. Accept
  // any object whose `adapters` is an array (the per-adapter fields can extend
  // additively); anything else normalizes to undefined.
  const macStabilityCandidate = (raw as { macStability?: unknown })
    .macStability;
  const macStability: AgentCapabilities["macStability"] =
    typeof macStabilityCandidate === "object" &&
    macStabilityCandidate !== null &&
    Array.isArray((macStabilityCandidate as { adapters?: unknown }).adapters)
      ? (macStabilityCandidate as AgentCapabilities["macStability"])
      : undefined;

  // Management-link health: accept an object whose `state` is one of the known
  // values (healthy / degraded / down); the per-field shape can extend
  // additively. Anything else (absent, an unknown state, a non-object)
  // normalizes to undefined so the card stays hidden until a known value
  // arrives.
  const managementLinkCandidate = (raw as { managementLink?: unknown })
    .managementLink;
  const mlState =
    typeof managementLinkCandidate === "object" &&
    managementLinkCandidate !== null
      ? (managementLinkCandidate as { state?: unknown }).state
      : undefined;
  const managementLink: AgentCapabilities["managementLink"] =
    mlState === "healthy" || mlState === "degraded" || mlState === "down"
      ? (managementLinkCandidate as AgentCapabilities["managementLink"])
      : undefined;

  // WiFi power-save reconciler verdicts: a forward-permissive object pass-
  // through. Accept any object whose `interfaces` is an array (the per-interface
  // fields can extend additively); anything else normalizes to undefined so the
  // card stays hidden until a well-formed block arrives.
  const wifiPowersaveCandidate = (raw as { wifiPowersave?: unknown })
    .wifiPowersave;
  const wifiPowersave: AgentCapabilities["wifiPowersave"] =
    typeof wifiPowersaveCandidate === "object" &&
    wifiPowersaveCandidate !== null &&
    Array.isArray(
      (wifiPowersaveCandidate as { interfaces?: unknown }).interfaces,
    )
      ? (wifiPowersaveCandidate as AgentCapabilities["wifiPowersave"])
      : undefined;

  // Management-link reach-back mode: clamp to the known set; an unknown value
  // (or absence) normalizes to undefined so the GCS treats it as the implicit
  // "primary". The failover interface + reason ride along as nullable strings.
  const mgmtLinkModeCandidate = (raw as { mgmtLinkMode?: unknown }).mgmtLinkMode;
  const mgmtLinkMode: AgentCapabilities["mgmtLinkMode"] =
    mgmtLinkModeCandidate === "primary" ||
    mgmtLinkModeCandidate === "wifi_heartbeat" ||
    mgmtLinkModeCandidate === "none"
      ? mgmtLinkModeCandidate
      : undefined;
  const mgmtFailoverIfaceRaw = (raw as { mgmtFailoverIface?: unknown })
    .mgmtFailoverIface;
  const mgmtFailoverIface =
    typeof mgmtFailoverIfaceRaw === "string" ? mgmtFailoverIfaceRaw : undefined;
  const mgmtFailoverReasonRaw = (raw as { mgmtFailoverReason?: unknown })
    .mgmtFailoverReason;
  const mgmtFailoverReason =
    typeof mgmtFailoverReasonRaw === "string"
      ? mgmtFailoverReasonRaw
      : undefined;

  // USB-rehome state: clamp to the known set; absent / unknown → undefined so
  // the indicator stays hidden. The attempt count + last result ride along.
  const usbRehomeStateCandidate = (raw as { usbRehomeState?: unknown })
    .usbRehomeState;
  const usbRehomeState: AgentCapabilities["usbRehomeState"] =
    usbRehomeStateCandidate === "idle" ||
    usbRehomeStateCandidate === "rehoming" ||
    usbRehomeStateCandidate === "exhausted" ||
    usbRehomeStateCandidate === "guard_blocked"
      ? usbRehomeStateCandidate
      : undefined;
  const usbRehomeAttemptsRaw = (raw as { usbRehomeAttempts?: unknown })
    .usbRehomeAttempts;
  const usbRehomeAttempts =
    typeof usbRehomeAttemptsRaw === "number" &&
    Number.isFinite(usbRehomeAttemptsRaw)
      ? usbRehomeAttemptsRaw
      : undefined;
  const usbRehomeLastResultRaw = (raw as { usbRehomeLastResult?: unknown })
    .usbRehomeLastResult;
  const usbRehomeLastResult =
    typeof usbRehomeLastResultRaw === "string"
      ? usbRehomeLastResultRaw
      : undefined;

  // Pass-through: camera + vision navigation block. The Zod raw
  // schema validates the inner shape (four required keys + optional
  // metrics); a payload that fails the schema falls through to
  // undefined so downstream selectors see the absence cleanly. The
  // schema's NumberLike preprocessor coerces stringly-typed metrics
  // back to numbers, so the parsed shape is safe to surface as a
  // NavigationCapability.
  const navigation: NavigationCapability | undefined = data.navigation
    ? (data.navigation as NavigationCapability)
    : undefined;

  const asStringOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const asNumberOrNull = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const peerDeviceId = asStringOrNull((data as Record<string, unknown>).peerDeviceId);
  const peerRole = asStringOrNull((data as Record<string, unknown>).peerRole);
  const peerChannel = asNumberOrNull((data as Record<string, unknown>).peerChannel);
  const peerRssiDbm = asNumberOrNull((data as Record<string, unknown>).peerRssiDbm);
  const peerSeenAtUnix = asNumberOrNull((data as Record<string, unknown>).peerSeenAtUnix);
  const cameraStateRaw = (data as Record<string, unknown>).cameraState;
  const cameraState =
    typeof cameraStateRaw === "string"
    && (cameraStateRaw === "ready" || cameraStateRaw === "missing" || cameraStateRaw === "error")
      ? cameraStateRaw
      : null;
  // Camera-recovery block: validated + coerced through the shared parser.
  // An absent / malformed value (unknown state, non-object) drops to
  // undefined so the indicator stays hidden on legacy heartbeats.
  const cameraUsbRecovery = normalizeCameraUsbRecovery(
    (data as Record<string, unknown>).cameraUsbRecovery,
  );

  // Pass-through: vision availability + live-detection summary. Both
  // come from the heartbeat (infer-capabilities sets visionAvailable;
  // the cloud bridge forwards visionSummary). The schema is
  // forward-permissive, so read the fields directly off the input and
  // coerce defensively. Absent fields stay undefined so a sparse tick
  // doesn't fabricate an idle summary.
  const visionAvailableRaw = (data as Record<string, unknown>)
    .visionAvailable;
  const visionAvailable =
    typeof visionAvailableRaw === "boolean" ? visionAvailableRaw : undefined;
  const visionSummaryRaw = (data as Record<string, unknown>).visionSummary;
  let visionSummary: AgentCapabilities["visionSummary"];
  if (visionSummaryRaw && typeof visionSummaryRaw === "object") {
    const vs = visionSummaryRaw as Record<string, unknown>;
    visionSummary = {
      activeModel:
        typeof vs.activeModel === "string"
          ? vs.activeModel
          : vs.activeModel === null
            ? null
            : undefined,
      backend:
        typeof vs.backend === "string"
          ? vs.backend
          : vs.backend === null
            ? null
            : undefined,
      detectionsPerSec:
        typeof vs.detectionsPerSec === "number" &&
        Number.isFinite(vs.detectionsPerSec)
          ? vs.detectionsPerSec
          : undefined,
      fps:
        typeof vs.fps === "number" && Number.isFinite(vs.fps)
          ? vs.fps
          : undefined,
    };
  }

  // CAN bus list. The agent omits the field entirely until the FC
  // parameter cache has at least one CAN_P*_DRIVER / BITRATE / CAN_D*_PROTOCOL
  // entry, so `undefined` means "not yet known"; an empty array would
  // mean "agent has the params but reports both ports disabled".
  // Inner shape is validated structurally rather than via Zod so
  // future fields (frame error counters, utilization) pass through
  // without bumping the normalizer.
  // Perception execution tier + offload target. Both come from the heartbeat
  // once the agent wires the tier signal. The tier clamps to the known set so a
  // stale / future string reads as "unknown" (undefined) rather than a
  // fabricated tier; npuTops / hasAccelerator are top-level convenience mirrors
  // (a consumer falls back to compute.* when they are absent).
  const perceptionTierRaw = (data as Record<string, unknown>).perceptionTier;
  const perceptionTier: AgentCapabilities["perceptionTier"] =
    perceptionTierRaw === "local" ||
    perceptionTierRaw === "offload" ||
    perceptionTierRaw === "hybrid" ||
    perceptionTierRaw === "none"
      ? perceptionTierRaw
      : undefined;
  const perceptionOffloadTargetRaw = (data as Record<string, unknown>)
    .perceptionOffloadTarget;
  const perceptionOffloadTarget =
    typeof perceptionOffloadTargetRaw === "string" &&
    perceptionOffloadTargetRaw.length > 0
      ? perceptionOffloadTargetRaw
      : perceptionOffloadTargetRaw === null
        ? null
        : undefined;
  const npuTopsRaw = (data as Record<string, unknown>).npuTops;
  const topLevelNpuTops =
    typeof npuTopsRaw === "number" && Number.isFinite(npuTopsRaw)
      ? npuTopsRaw
      : undefined;
  const hasAcceleratorRaw = (data as Record<string, unknown>).hasAccelerator;
  const hasAccelerator =
    typeof hasAcceleratorRaw === "boolean" ? hasAcceleratorRaw : undefined;

  const canBusesRaw = (data as Record<string, unknown>).canBuses;
  let canBuses: AgentCapabilities["canBuses"] | undefined;
  if (Array.isArray(canBusesRaw)) {
    canBuses = canBusesRaw.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const e = entry as Record<string, unknown>;
      if (
        typeof e.port !== "number"
        || typeof e.driver !== "number"
        || typeof e.bitrate !== "number"
        || typeof e.protocol !== "number"
      ) {
        return [];
      }
      return [{
        port: e.port,
        driver: e.driver,
        bitrate: e.bitrate,
        protocol: e.protocol,
      }];
    });
  }

  return {
    tier: Number(data.tier ?? 0),
    cameras,
    videoStreams,
    compute,
    vision,
    models,
    display,
    displayType,
    videoLocalTap,
    videoRecording,
    uiTheme,
    runtimeMode,
    radioStackState,
    macStability,
    managementLink,
    wifiPowersave,
    mgmtLinkMode,
    mgmtFailoverIface,
    mgmtFailoverReason,
    usbRehomeState,
    usbRehomeAttempts,
    usbRehomeLastResult,
    navigation,
    peerDeviceId,
    peerRole,
    peerChannel,
    peerRssiDbm,
    peerSeenAtUnix,
    cameraState,
    cameraUsbRecovery,
    canBuses,
    visionAvailable,
    visionSummary,
    perceptionTier,
    perceptionOffloadTarget,
    npuTops: topLevelNpuTops,
    hasAccelerator,
  };
}
