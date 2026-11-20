/**
 * @module schemaDroneStatusSurfaces
 * @description Second half of the `cmd_droneStatus` columns: perception, plugins, peers, local surfaces.
 *
 * Shared by every deployment; composed by `schemaTables.ts`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const droneStatusSurfaceFields = {
  // Generic plugin-state channel: a map from plugin id to that plugin's own
  // opaque telemetry slice, ferried verbatim by the heartbeat producer (it
  // reads /run/ados/plugins/<id>-state.json). The core knows nothing about any
  // plugin's slice shape — each plugin owns + validates its own. This is how a
  // plugin surfaces runtime telemetry to the cloud GCS without adding core
  // columns; the 50th plugin adds none.
  pluginState: v.optional(v.record(v.string(), v.any())),
  // Setup wizard state on the agent. Live agents report "configured"
  // once the universal webapp wizard has been completed. Older agents
  // omit this and the GCS treats them as configured by default.
  setupState: v.optional(v.string()),
  // How the agent landed on its current profile. One of "detected"
  // (auto-detected by hardware fingerprint), "tiebreaker" (auto with
  // ambiguous signals), "default" (no detect signals, fell back),
  // "override" (forced via /etc/ados/board_override), or "user"
  // (operator picked in the setup webapp).
  profileSource: v.optional(v.string()),
  // Top-level mirror of the selected WFB radio adapter (also nested
  // inside the radio block). `wfbAdapterChipset` is the detected
  // chipset string or null; `wfbAdapterInjectionOk` is true when the
  // adapter entered monitor mode and can inject, false when no
  // injection-capable adapter was found. Optional so older agents that
  // omit them round-trip cleanly.
  wfbAdapterChipset: v.optional(v.union(v.string(), v.null())),
  wfbAdapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
  // USB link health of the selected adapter. `wfbAdapterUsbDegraded` is true
  // when it enumerated on a slow (12 Mbps full-speed) USB link and may emit no
  // RF despite advancing tx_bytes; `wfbAdapterUsbSpeedMbps` is the speed.
  wfbAdapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
  wfbAdapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
  // Radio link snapshot from the air-side WFB-ng pipeline. Populated
  // from the agent heartbeat when the radio service is running. Field
  // names are camelCase here even though the agent emits snake_case
  // on the wire; the cloud relay HTTP action remaps the keys before
  // calling pushStatus.
  radio: v.optional(v.object({
    state: v.string(),
    iface: v.union(v.string(), v.null()),
    driver: v.union(v.string(), v.null()),
    channel: v.union(v.number(), v.null()),
    freqMhz: v.union(v.number(), v.null()),
    bandwidthMhz: v.union(v.number(), v.null()),
    txPowerDbm: v.union(v.number(), v.null()),
    txPowerMaxDbm: v.union(v.number(), v.null()),
    topology: v.union(v.string(), v.null()),
    rssiDbm: v.union(v.number(), v.null()),
    bitrateKbps: v.union(v.number(), v.null()),
    fecRecovered: v.union(v.number(), v.null()),
    fecLost: v.union(v.number(), v.null()),
    packetsLost: v.union(v.number(), v.null()),
    // Channel rendezvous + hop surface. Both sides boot on the fixed
    // home channel and only hop once the link is up. Newer agents
    // report the hop supervisor and peer-rendezvous state so a stuck
    // link (searching for a peer, monitor mode wedged, not actually
    // transmitting) is visible remotely. Optional + nullable: older
    // agents omit them.
    homeChannel: v.optional(v.union(v.number(), v.null())),
    band: v.optional(v.union(v.string(), v.null())),
    regDomain: v.optional(v.union(v.string(), v.null())),
    // Operating-region posture. regPosture is "unrestricted" (radio
    // transmits without a pinned region) or "region" (an operating
    // region is pinned and the strict gate is in force). pinnedRegion is
    // the pinned ISO 3166-1 alpha-2 code; regVerified is true once a
    // pinned region is confirmed effective. Optional + nullable: older
    // agents omit them and render the unrestricted default.
    regPosture: v.optional(v.union(v.string(), v.null())),
    pinnedRegion: v.optional(v.union(v.string(), v.null())),
    regVerified: v.optional(v.union(v.boolean(), v.null())),
    monitorActive: v.optional(v.union(v.boolean(), v.null())),
    txActive: v.optional(v.union(v.boolean(), v.null())),
    peerLink: v.optional(v.union(v.string(), v.null())),
    hopState: v.optional(v.union(v.string(), v.null())),
    // Receive-side link quality. Forwarded by newer agents on both
    // the transmit and receive sides; on a ground station these track
    // the downlink it decodes. Older agents omit them; v.optional +
    // null covers missing-key and explicit-null shapes alike.
    snrDb: v.optional(v.union(v.number(), v.null())),
    noiseDbm: v.optional(v.union(v.number(), v.null())),
    lossPercent: v.optional(v.union(v.number(), v.null())),
    mcsIndex: v.optional(v.union(v.number(), v.null())),
    rxSilentSeconds: v.optional(v.union(v.number(), v.null())),
    // Per-stream video-tx liveness. Newer agents flag a
    // wedged video transmitter (UDP ingress backlog pinned while the
    // process is alive) so a silent video stall is visible remotely.
    // Optional + nullable: older agents omit them.
    txVideoStalled: v.optional(v.union(v.boolean(), v.null())),
    txVideoStallKills: v.optional(v.union(v.number(), v.null())),
    txVideoRecvqBytes: v.optional(v.union(v.number(), v.null())),
    // Ground-side receive acquisition surface. A receiver hunts for a
    // valid-decode channel ("searching"), settles once it locks
    // ("locked"), or reports it has heard nothing from a peer yet
    // ("no-peer"). `channelLocked` is the boolean form of that lock.
    // `reacquireKills` counts destructive ground wfb_rx restarts from
    // the valid-packet watchdog; a climbing value means the receive
    // link is thrashing. `rxZombieKills` counts restarts the receive
    // liveness watchdog fired because wfb_rx was alive yet had stopped
    // decoding (a process-silent stall, distinct from a decode thrash).
    // `validRxPacketsPerS` is the per-second valid WFB decode rate on
    // the ground. Optional + nullable: agents on the transmit side and
    // older agents omit them.
    acquireState: v.optional(v.union(v.string(), v.null())),
    channelLocked: v.optional(v.union(v.boolean(), v.null())),
    // The other half of the received-side proof: true when the transmit
    // counter advances while no return signal has been confirmed. Null means
    // "no verdict" and is NOT the same as false — a false would claim the
    // transmit path had been proven, so the null must be storable. Optional +
    // nullable: older agents omit it.
    rfUnverified: v.optional(v.union(v.boolean(), v.null())),
    reacquireKills: v.optional(v.union(v.number(), v.null())),
    rxZombieKills: v.optional(v.union(v.number(), v.null())),
    validRxPacketsPerS: v.optional(v.union(v.number(), v.null())),
    // Selected WFB radio adapter surface. `adapterChipset` is the
    // detected chipset string (e.g. "RTL8812EU") or null when unknown.
    // `adapterInjectionOk` is true when the selected adapter entered
    // monitor mode and is injection-capable, false when no
    // injection-capable adapter was found (the agent then refuses to
    // transmit). Optional + nullable: older agents omit them.
    adapterChipset: v.optional(v.union(v.string(), v.null())),
    adapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
    // USB link health of the selected adapter (see the top-level
    // wfbAdapterUsb* fields). Optional + nullable; older agents omit them.
    adapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
    adapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
    // PHY at the muted txpower floor: the adapter injects frames yet
    // radiates nothing (txpower readback collapses toward the floor,
    // carrier down). Distinct from adapterUsbDegraded (slow USB link) and
    // adapterInjectionOk (no injection-capable adapter). Optional +
    // nullable; older agents omit it.
    phyMuted: v.optional(v.union(v.boolean(), v.null())),
    // Live radio tuning surface. fecK/fecN are the data plane's running
    // Reed-Solomon ratio (mcsIndex above is its running rate). linkPreset is
    // the operator-facing preset name. adaptiveBitrateEnabled is true when the
    // closed-loop FEC controller is armed; the recommendedTier* fields are its
    // current ladder rung. Optional + nullable: older agents omit them.
    fecK: v.optional(v.union(v.number(), v.null())),
    fecN: v.optional(v.union(v.number(), v.null())),
    linkPreset: v.optional(v.union(v.string(), v.null())),
    adaptiveBitrateEnabled: v.optional(v.union(v.boolean(), v.null())),
    recommendedTierIdx: v.optional(v.union(v.number(), v.null())),
    recommendedTierName: v.optional(v.union(v.string(), v.null())),
    recommendedBitrateKbps: v.optional(v.union(v.number(), v.null())),
    // Radio-data-plane churn + transmit-rate observability. The live
    // radio sidecar carries these counters so a thrashing or zombie
    // transmitter is visible remotely. Null when an older sidecar omits
    // them so the UI tells "no reading" from a real zero.
    txZombieKills: v.optional(v.union(v.number(), v.null())),
    txBytesPerS: v.optional(v.union(v.number(), v.null())),
    restartCount: v.optional(v.union(v.number(), v.null())),
    // Pair-state surface added in agent v0.16. Old rows from
    // pre-0.16 heartbeats lack these fields; the cloud relay
    // remap leaves them undefined and the GCS treats them as
    // "unpaired". v.optional + v.union(...,v.null()) covers both
    // shapes the relay may forward (missing key vs explicit null).
    paired: v.optional(v.boolean()),
    pairedWithDeviceId: v.optional(v.union(v.string(), v.null())),
    pairedAt: v.optional(v.union(v.string(), v.null())),
    publicKeyFingerprint: v.optional(v.union(v.string(), v.null())),
    autoPairEnabled: v.optional(v.union(v.boolean(), v.null())),
    // The auto-pair re-arm this rig's key last took (agent `pair_rearm`).
    pairRearm: v.optional(v.union(v.object({
      cause: v.union(v.string(), v.null()),
      at: v.number(),
      episodes: v.number(),
      active: v.boolean(),
    }), v.null())),
  })),
  // CRSF/ExpressLRS control-lane telemetry, mirrored from the agent's
  // crsf-stats sidecar. Pre-declared ahead of the emitting agent: the
  // strict args validator rejects an undeclared key and fails the
  // ENTIRE heartbeat the moment an agent starts sending the block.
  // The whole block is optional — absent when the control-lane service
  // is not running or its sidecar is stale — and every field inside is
  // optional + nullable: numbers/strings are null when unmeasured, and
  // a null rfUnverified means "no verdict" (never a fabricated false,
  // which would claim the transmit path had been proven).
  crsf: v.optional(v.object({
    v: v.optional(v.union(v.number(), v.null())),
    state: v.optional(v.union(v.string(), v.null())),
    rssiDbm: v.optional(v.union(v.number(), v.null())),
    lqUplink: v.optional(v.union(v.number(), v.null())),
    lqDownlink: v.optional(v.union(v.number(), v.null())),
    snrDb: v.optional(v.union(v.number(), v.null())),
    band: v.optional(v.union(v.string(), v.null())),
    packetRateHz: v.optional(v.union(v.number(), v.null())),
    txPowerMw: v.optional(v.union(v.number(), v.null())),
    txFramesPerS: v.optional(v.union(v.number(), v.null())),
    rxFramesPerS: v.optional(v.union(v.number(), v.null())),
    rfUnverified: v.optional(v.union(v.boolean(), v.null())),
    mode: v.optional(v.union(v.string(), v.null())),
    channelSource: v.optional(v.union(v.string(), v.null())),
    relayRole: v.optional(v.union(v.string(), v.null())),
    fcCommandDownGated: v.optional(v.union(v.boolean(), v.null())),
  })),
  // Node lane flags, the same booleans `/api/status/full` carries on the
  // LAN: a working GNSS lane, an enabled LoRa lane, and simulation mode.
  gnss: v.optional(v.boolean()),
  lora: v.optional(v.boolean()),
  sim: v.optional(v.boolean()),
// Local SPI LCD surface state. Reported by the agent's OLED/LCD
  // service when a panel is attached and the renderer is active.
  // All fields are optional so heartbeats from agents without a
  // local display (or pre-LCD agent versions) leave them undefined.
  lcdActivePage: v.optional(v.string()),
  lcdTouchCalibrated: v.optional(v.boolean()),
  lcdRotation: v.optional(v.number()),
  lcdSnapshotUrl: v.optional(v.string()),
  lcdLastTouchAt: v.optional(v.number()),
  lcdLastGesture: v.optional(v.string()),
  // Local on-board video surface (the LCD video page tap). Reports
  // whether the agent is decoding a stream locally for the panel and
  // whether a recording is in progress. Independent of the WHEP
  // browser stream advertised via videoState/videoWhepUrl.
  videoLocalDecoderActive: v.optional(v.boolean()),
  videoLocalDecoderType: v.optional(v.string()),
  videoLocalDecoderFps: v.optional(v.number()),
  videoRecording: v.optional(v.boolean()),
  // Effective primary local-display path resolved by the agent each
  // heartbeat. Values: "hdmi" | "lcd" | "none". Reflects the operator's
  // ground_station.display.type config when set explicitly; under "auto"
  // the agent probes both renderers and HDMI wins when both are wired.
  // Distinct from the runtime `display` block (which describes the SPI
  // LCD peripheral specifically). Undefined on agents that predate the
  // enrichment.
  displayType: v.optional(v.string()),
  // Operator-selected UI theme on the agent. Mirrored back so the
  // GCS can reflect the same theme on its own surfaces and the
  // welcome flow can detect drift.
  uiTheme: v.optional(v.string()),
  // Epoch milliseconds of the last time the agent's plugin update
  // checker ran a registry sweep against the installed plugins.
  // Surfaced in the per-plugin update settings drawer so an operator
  // can confirm the auto-update loop is alive. Older agents that
  // predate the loop omit this field; the GCS renders "Never checked".
  last_plugin_update_check_at: v.optional(v.number()),
  // Inter-rig peer presence — populated by the agent's HopListener
  // when it decodes a WFB-radio PresenceBeacon from the paired peer.
  // All five fields are optional; they stay undefined until at least
  // one beacon decodes and the agent's 60s freshness gate accepts.
  // Drone heartbeats carry the GS's identity; GS heartbeats carry
  // the drone's identity.
  peerDeviceId: v.optional(v.union(v.string(), v.null())),
  peerRole: v.optional(v.union(v.string(), v.null())),
  peerChannel: v.optional(v.union(v.number(), v.null())),
  peerRssiDbm: v.optional(v.union(v.number(), v.null())),
  peerSeenAtUnix: v.optional(v.union(v.number(), v.null())),
  // The LIST of WFB peers a ground station relays (a GS can be linked to
  // more than one drone, which the scalar peer* fields above cannot
  // represent). Populated from the agent's linked-peers sidecar; each entry
  // carries only what the PresenceBeacon + listener decode. A GCS paired
  // only to the ground node reads this to enrol each drone as its own node.
  // Absent on a drone / a peerless ground node; the strict inner v.object
  // rejects an undeclared key, so it declares exactly the producer's set.
  linkedPeers: v.optional(
    v.array(
      v.object({
        deviceId: v.string(),
        role: v.optional(v.union(v.string(), v.null())),
        channel: v.optional(v.union(v.number(), v.null())),
        rssiDbm: v.optional(v.union(v.number(), v.null())),
        seenAtUnix: v.optional(v.union(v.number(), v.null())),
      }),
    ),
  ),
  // Primary camera discovery state on the air-side video pipeline.
  // "ready" → at least one camera assigned and live. "missing" →
  // pipeline scanned but no v4l2 node enumerated. "error" → driver
  // or HAL probe failed. Older agents that predate the surface
  // omit the field (the drone card hides the pill).
  cameraState: v.optional(v.union(v.string(), v.null())),
  // USB camera-recovery self-heal state from the air-side reconciler.
  // `state` walks idle → monitoring → rebinding → port_cycling →
  // hub_resetting / needs_hub_reset / guard_blocked / exhausted; `case`
  // is the agent's diagnosis of the missing-camera situation (or null);
  // the remaining fields bound the recovery episode. Inner fields are
  // optional + nullable so a slightly older agent payload still
  // validates. The GCS capability store reads this to drive the
  // camera-reseat badge remotely. Absent on agents that predate it.
  cameraUsbRecovery: v.optional(
    v.object({
      state: v.optional(v.union(v.string(), v.null())),
      case: v.optional(v.union(v.string(), v.null())),
      attempts: v.optional(v.union(v.number(), v.null())),
      maxAttempts: v.optional(v.union(v.number(), v.null())),
      cameraPresent: v.optional(v.union(v.boolean(), v.null())),
      expected: v.optional(v.union(v.boolean(), v.null())),
      pppsCapable: v.optional(v.union(v.boolean(), v.null())),
    }),
  ),
  // FC CAN bus configuration. Array of per-port entries. Absent
  // during warmup; empty array means agent has the params but
  // reports both ports disabled.
  canBuses: v.optional(v.array(v.object({
    port: v.number(),
    driver: v.number(),
    bitrate: v.number(),
    protocol: v.number(),
  }))),
  // Vision engine summary. Populated each heartbeat when a detection
  // model is loaded. `visionActiveModel` is the active model id (null
  // when idle); `visionBackend` is the inference backend ("ort" |
  // "rknn" | "mock"); `visionDetectionsPerSec` and `visionFps` are the
  // rolling throughput figures. All optional so agents that predate
  // the vision surface round-trip cleanly; old rows read back as
  // undefined and the drone-detail Vision tab renders an idle state.
  visionActiveModel: v.optional(v.union(v.string(), v.null())),
  visionBackend: v.optional(v.union(v.string(), v.null())),
  visionDetectionsPerSec: v.optional(v.number()),
  visionFps: v.optional(v.number()),
  // Per-service config-load errors. Each entry names a service whose
  // config file failed to parse (the agent kept running on built-in
  // defaults for that service). Present only for services currently in
  // an errored state; empty/absent when every config loaded cleanly.
  // Older agents omit it so old rows read back as undefined and the
  // drone-detail Health surface shows no error banner.
  configErrors: v.optional(
    v.array(
      v.object({
        service: v.string(),
        error: v.string(),
      }),
    ),
  ),
  updatedAt: v.number(),
};
