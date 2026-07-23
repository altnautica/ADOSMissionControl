/**
 * @module AgentCapabilities/Normalizer
 * @description Pure shape mappers that flatten the on-wire agent capabilities
 * payload onto the GCS-side TypeScript types. The agent has shipped several
 * legacy shapes over time (features as an array OR { enabled, active }, models
 * as an array OR { installed, cache_used_mb, ... }); the normalizer collapses
 * those into a single canonical shape the store can hold.
 *
 * Smaller forward-permissive per-field parsers live in `./derivers`. Defaults
 * for compute / vision / models / features are exported here so the state
 * module can seed the initial Zustand state.
 *
 * Every helper here is a pure function: no Zustand access, no side effects.
 *
 * @license GPL-3.0-only
 */

import type {
  AgentCapabilities,
  CameraCapability,
  VideoStreamLeg,
  ComputeCapability,
  VisionState,
  ModelCacheInfo,
  InstalledModel,
  NavigationCapability,
} from "@/lib/agent/feature-types";
import { AgentCapabilitiesRawSchema } from "@/lib/agent/schemas";
import { normalizeCameraUsbRecovery } from "@/lib/agent/camera-recovery";
import type {
  RadioState,
  RadioLinkState,
  RadioTopology,
  RadioPeerLink,
  RadioHopState,
  RadioAcquireState,
  RadioLinkDiag,
  CrsfState,
  CrsfLinkState,
} from "@/lib/api/ground-station/types";

export const DEFAULT_COMPUTE: ComputeCapability = {
  npu_available: false,
  npu_runtime: null,
  npu_tops: 0,
  npu_utilization_pct: 0,
  gpu_available: false,
};

export const DEFAULT_VISION: VisionState = {
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
};

export const DEFAULT_MODELS: ModelCacheInfo = {
  installed: [],
  cache_used_mb: 0,
  cache_max_mb: 500,
  registry_url: "",
};

// Recognized literal values for the radio link state and the power
// topology. Unknown values fall back to safe defaults so the UI never
// crashes on a future agent that ships an extension.
const RADIO_LINK_STATES: ReadonlySet<RadioLinkState> = new Set<RadioLinkState>([
  "absent",
  "disconnected",
  "unpaired",
  "auto_pairing",
  "binding",
  "connecting",
  "connected",
  "degraded",
  "rf_unverified",
]);
const RADIO_TOPOLOGIES: ReadonlySet<RadioTopology> = new Set<RadioTopology>([
  "host_vbus",
  "powered_hub",
  "external_5v",
]);
const RADIO_PEER_LINKS: ReadonlySet<RadioPeerLink> = new Set<RadioPeerLink>([
  "linked",
  "searching",
  "no_peer",
]);
const RADIO_HOP_STATES: ReadonlySet<RadioHopState> = new Set<RadioHopState>([
  "idle",
  "searching",
  "locked",
  "hopping",
]);
const RADIO_ACQUIRE_STATES: ReadonlySet<RadioAcquireState> =
  new Set<RadioAcquireState>(["idle", "searching", "locked", "no-peer"]);
const RADIO_LINK_DIAGS: ReadonlySet<RadioLinkDiag> = new Set<RadioLinkDiag>([
  "deaf",
  "mis_keyed",
  "jammed",
  "healthy",
  "searching",
]);

/** Normalize the on-wire radio block onto the GCS RadioState shape. */
export function normalizeRadio(raw: unknown): RadioState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const stateRaw = typeof r.state === "string" ? r.state : "absent";
  const state: RadioLinkState = RADIO_LINK_STATES.has(
    stateRaw as RadioLinkState,
  )
    ? (stateRaw as RadioLinkState)
    : "absent";
  const topologyRaw = typeof r.topology === "string" ? r.topology : "host_vbus";
  const topology: RadioTopology = RADIO_TOPOLOGIES.has(
    topologyRaw as RadioTopology,
  )
    ? (topologyRaw as RadioTopology)
    : "host_vbus";
  const num = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    return null;
  };
  const numOrZero = (v: unknown): number => {
    const n = num(v);
    return n ?? 0;
  };
  return {
    state,
    iface: typeof r.iface === "string" ? r.iface : null,
    driver: typeof r.driver === "string" ? r.driver : null,
    channel: num(r.channel),
    freqMhz: num(r.freqMhz),
    bandwidthMhz: numOrZero(r.bandwidthMhz),
    txPowerDbm: num(r.txPowerDbm),
    txPowerMaxDbm: numOrZero(r.txPowerMaxDbm),
    topology,
    rssiDbm: num(r.rssiDbm),
    bitrateKbps: num(r.bitrateKbps),
    fecRecovered: numOrZero(r.fecRecovered),
    fecLost: numOrZero(r.fecLost),
    packetsLost: numOrZero(r.packetsLost),
    // Channel rendezvous + hop surface. Both sides start on the fixed
    // home channel and only hop once the link is up. Optional on the
    // wire; null when absent so the UI can skip a missing row.
    homeChannel: num(r.homeChannel),
    band: typeof r.band === "string" ? r.band : null,
    regDomain:
      typeof r.regDomain === "string" && r.regDomain.length > 0
        ? r.regDomain
        : null,
    // Operating-region posture. "unrestricted" | "region" only; any other
    // string (or absent field) normalizes to null so an older agent that
    // omits it renders the unrestricted default without a bad badge.
    regPosture:
      r.regPosture === "unrestricted" || r.regPosture === "region"
        ? r.regPosture
        : null,
    pinnedRegion:
      typeof r.pinnedRegion === "string" && r.pinnedRegion.length > 0
        ? r.pinnedRegion
        : null,
    regVerified:
      typeof r.regVerified === "boolean" ? r.regVerified : null,
    monitorActive:
      typeof r.monitorActive === "boolean" ? r.monitorActive : null,
    txActive: typeof r.txActive === "boolean" ? r.txActive : null,
    peerLink:
      typeof r.peerLink === "string" &&
      RADIO_PEER_LINKS.has(r.peerLink as RadioPeerLink)
        ? (r.peerLink as RadioPeerLink)
        : null,
    hopState:
      typeof r.hopState === "string" &&
      RADIO_HOP_STATES.has(r.hopState as RadioHopState)
        ? (r.hopState as RadioHopState)
        : null,
    // Receive-side link quality. Optional on the wire; null when a
    // field is absent or non-finite so the UI can skip a missing row.
    snrDb: num(r.snrDb),
    noiseDbm: num(r.noiseDbm),
    lossPercent: num(r.lossPercent),
    mcsIndex: num(r.mcsIndex),
    rxSilentSeconds: num(r.rxSilentSeconds),
    // Per-stream video-tx liveness. Optional on the wire; null when
    // absent so the UI can distinguish "no reading" from a real false.
    txVideoStalled:
      typeof r.txVideoStalled === "boolean" ? r.txVideoStalled : null,
    txVideoStallKills: num(r.txVideoStallKills),
    txVideoRecvqBytes: num(r.txVideoRecvqBytes),
    // Ground-side receive acquisition surface. Optional on the wire;
    // null when absent or non-finite so the UI can skip a missing row.
    // An unknown acquireState string falls to null rather than pinning a
    // bad badge.
    acquireState:
      typeof r.acquireState === "string" &&
      RADIO_ACQUIRE_STATES.has(r.acquireState as RadioAcquireState)
        ? (r.acquireState as RadioAcquireState)
        : null,
    channelLocked:
      typeof r.channelLocked === "boolean" ? r.channelLocked : null,
    // The radio's own transmit-proof verdict. Anything that is not a real
    // boolean — an absent key on an older agent, a null the agent sends when
    // it has no radio view, a stale snapshot — normalizes to null, which the
    // UI reads as "no verdict". Defaulting to false here would fabricate a
    // claim that the transmit path had been proven.
    rfUnverified: typeof r.rfUnverified === "boolean" ? r.rfUnverified : null,
    reacquireKills: num(r.reacquireKills),
    rxZombieKills: num(r.rxZombieKills),
    validRxPacketsPerS: num(r.validRxPacketsPerS),
    // WFB link-diagnosis verdict + received-frame counters. Optional on
    // the wire; an unknown verdict string falls to null (no fabricated
    // "healthy") and the counters use num() so an absent field stays null
    // rather than a misleading 0.
    linkDiag:
      typeof r.linkDiag === "string" &&
      RADIO_LINK_DIAGS.has(r.linkDiag as RadioLinkDiag)
        ? (r.linkDiag as RadioLinkDiag)
        : null,
    packetsAll: num(r.packetsAll),
    decryptErrors: num(r.decryptErrors),
    // WFB adapter selection surface. The chipset is null when unknown.
    // `adapterInjectionOk` distinguishes an explicit false (no
    // injection-capable adapter found — the agent refuses to transmit)
    // from absent (older agent that doesn't report it) so the UI only
    // warns when the agent actually says the adapter can't inject.
    // Newer agents nest these as adapterChipset / adapterInjectionOk; the
    // top-level wfbAdapterChipset / wfbAdapterInjectionOk are accepted as
    // a fallback for the same reading.
    adapterChipset:
      typeof r.adapterChipset === "string" && r.adapterChipset.length > 0
        ? r.adapterChipset
        : typeof r.wfbAdapterChipset === "string" &&
            r.wfbAdapterChipset.length > 0
          ? r.wfbAdapterChipset
          : null,
    adapterInjectionOk:
      typeof r.adapterInjectionOk === "boolean"
        ? r.adapterInjectionOk
        : typeof r.wfbAdapterInjectionOk === "boolean"
          ? r.wfbAdapterInjectionOk
          : null,
    // USB link health of the selected adapter. `adapterUsbDegraded` true means
    // the adapter enumerated on a slow (full-speed, 12 Mbps) USB link and can
    // advance tx_bytes yet emit no usable RF — a loud warning state. Accept the
    // nested or the top-level wfbAdapter* spelling, same as injectionOk.
    adapterUsbDegraded:
      typeof r.adapterUsbDegraded === "boolean"
        ? r.adapterUsbDegraded
        : typeof r.wfbAdapterUsbDegraded === "boolean"
          ? r.wfbAdapterUsbDegraded
          : null,
    adapterUsbSpeedMbps: num(r.adapterUsbSpeedMbps ?? r.wfbAdapterUsbSpeedMbps),
    // PHY at the muted txpower floor: injects frames yet radiates nothing.
    // Optional on the wire; null when absent so the UI distinguishes "no
    // reading" from a real false. Defensive boolean pass-through like txActive.
    phyMuted: typeof r.phyMuted === "boolean" ? r.phyMuted : null,
    // Pair-state fields are optional on the wire (older agents omit
    // them). Treat absent / null as "unpaired, auto-pair unknown" so
    // the UI never confuses a missing field with an explicit false.
    paired: r.paired === true,
    pairedWithDeviceId:
      typeof r.pairedWithDeviceId === "string" ? r.pairedWithDeviceId : null,
    pairedAt: typeof r.pairedAt === "string" ? r.pairedAt : null,
    publicKeyFingerprint:
      typeof r.publicKeyFingerprint === "string"
        ? r.publicKeyFingerprint
        : null,
    // autoPairEnabled defaults to false when absent so the UI does
    // not show a misleading "armed" badge against an old agent that
    // doesn't actually run the auto-pair supervisor.
    autoPairEnabled: r.autoPairEnabled === true,
    // Live radio tuning surface. Optional on the wire; null when absent so the
    // tuning card knows "no reading" from a real value on an older agent.
    fecK: num(r.fecK),
    fecN: num(r.fecN),
    linkPreset: typeof r.linkPreset === "string" ? r.linkPreset : null,
    adaptiveBitrateEnabled:
      typeof r.adaptiveBitrateEnabled === "boolean"
        ? r.adaptiveBitrateEnabled
        : null,
    recommendedTierIdx: num(r.recommendedTierIdx),
    recommendedTierName:
      typeof r.recommendedTierName === "string" ? r.recommendedTierName : null,
    recommendedBitrateKbps: num(r.recommendedBitrateKbps),
  };
}

// The ados-crsf service's own coarse-state vocabulary. An unknown value (or an
// explicit null) normalizes to null so a future state the agent adds never
// pins a bad reading — the lane's own state, not this app's sentinel.
const CRSF_LINK_STATES: ReadonlySet<CrsfLinkState> = new Set<CrsfLinkState>([
  "unconfigured",
  "ready",
  "link_ok",
  "degraded",
  "rf_unverified",
  "disabled",
]);

/**
 * Normalize the CRSF / ExpressLRS control-lane block onto the GCS CrsfState
 * shape. The block reaches the GCS from two producers in two casings, and they
 * carry different field sets:
 *   - the cloud heartbeat (camelCase `rssiDbm`, ...; drops `flyable` + `pic`;
 *     its `txPowerDbm` is always null so no usable TX power travels), and
 *   - the LAN `GET /api/v1/ground-station/crsf` route (raw snake_case
 *     `rssi_dbm`, ...; carries `tx_power_mw` + `flyable` + `pic` verbatim).
 * Each field is read from whichever casing is present. A missing block — an
 * older agent that never emits crsf, or a lane that is down / whose sidecar is
 * stale (the heartbeat omits the whole block, the LAN route 404s) — returns
 * null so the store field reads absent rather than a fabricated all-null block.
 */
export function normalizeCrsf(raw: unknown): CrsfState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const str = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 ? v : null;
  const bool = (v: unknown): boolean | null =>
    typeof v === "boolean" ? v : null;
  // Read either casing. `??` is the right fold: a value that is legitimately
  // null on the present casing maps to null anyway, while a real `false` / `0`
  // survives (nullish coalescing skips only null/undefined). A payload is
  // one casing OR the other, never a mix, so there is no ambiguity.
  const stateRaw = r.state;
  const state: CrsfLinkState | null =
    typeof stateRaw === "string" &&
    CRSF_LINK_STATES.has(stateRaw as CrsfLinkState)
      ? (stateRaw as CrsfLinkState)
      : null;
  return {
    state,
    rssiDbm: num(r.rssiDbm ?? r.rssi_dbm),
    lqUplink: num(r.lqUplink ?? r.lq_uplink),
    lqDownlink: num(r.lqDownlink ?? r.lq_downlink),
    snrDb: num(r.snrDb ?? r.snr_db),
    band: str(r.band),
    packetRateHz: num(r.packetRateHz ?? r.packet_rate_hz),
    // TX power in mW comes ONLY from the LAN sidecar (`tx_power_mw`). The cloud
    // heartbeat's `txPowerDbm` is always null (the projection reads a field the
    // sidecar never emits), so it is never mapped here — over the heartbeat
    // this stays null, the honest reading, since no usable TX power travels.
    txPowerMw: num(r.tx_power_mw ?? r.txPowerMw),
    txFramesPerS: num(r.txFramesPerS ?? r.tx_frames_per_s),
    rxFramesPerS: num(r.rxFramesPerS ?? r.rx_frames_per_s),
    // The lane's own transmit-proof verdict. Anything that is not a real
    // boolean — an absent key, an explicit null, a stale snapshot — normalizes
    // to null, which reads as "no verdict". Defaulting to false would fabricate
    // a claim that the transmit path had been proven (the crsf sibling of the
    // radio rfUnverified tri-state).
    rfUnverified: bool(r.rfUnverified ?? r.rf_unverified),
    // Arm-safety verdict, LAN-sidecar only (the heartbeat projection drops it).
    // Null over the cloud path / on older agents rather than a fabricated false.
    flyable: bool(r.flyable),
    mode: str(r.mode),
    channelSource: str(r.channelSource ?? r.channel_source),
    // PIC arbiter, LAN-sidecar only (the heartbeat projection drops it).
    pic: str(r.pic),
    relayRole: str(r.relayRole ?? r.relay_role),
  };
}

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

  const videoPipelineCandidate = (raw as { videoPipeline?: unknown })
    .videoPipeline;
  const videoPipeline =
    videoPipelineCandidate && typeof videoPipelineCandidate === "object"
      ? (videoPipelineCandidate as AgentCapabilities["videoPipeline"])
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
    videoPipeline,
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
