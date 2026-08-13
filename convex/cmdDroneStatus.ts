/**
 * @module cmdDroneStatus
 * @description Convex functions for drone cloud status relay.
 * Agent pushes full system status via HTTP action. GCS reads via reactive query.
 * @license GPL-3.0-only
 */

import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOwnedDroneByDeviceId } from "./cmdDroneAccess";

/**
 * Push status from agent (called via HTTP action, no auth — validated by API key match).
 * Upserts by deviceId.
 */
export const pushStatus = internalMutation({
  args: {
    deviceId: v.string(),
    version: v.string(),
    uptimeSeconds: v.number(),
    boardName: v.optional(v.string()),
    boardTier: v.optional(v.number()),
    boardSoc: v.optional(v.string()),
    boardArch: v.optional(v.string()),
    // Probed-from-silicon hardware truth (kernel device-tree SoC, CPU
    // cluster summary, confirmed hardware H.264 encoder node). Optional so
    // older agents round-trip cleanly; persisted via the args spread.
    boardSocProbed: v.optional(v.string()),
    boardCpuProbed: v.optional(v.string()),
    hwEncoderProbed: v.optional(v.string()),
    // Kernel release + radio-module source + install-health summary.
    // All optional so an agent that predates the surface round-trips
    // cleanly; mirrors the boardArch/boardSoc handling.
    kernelRelease: v.optional(v.string()),
    wfbModuleSource: v.optional(v.string()),
    // Overall radio-stack health, distinct from the live pairing state.
    // One of "ok" | "no_injection" | "unpaired" | "no_bind_artifacts" |
    // "stack_incomplete". Persisted verbatim via the args spread so a
    // regression in the radio install surfaces on the overview. Older
    // agents omit it and the GCS defaults to a safe undefined.
    radioStackState: v.optional(v.string()),
    // Stable-MAC pin verdicts (object {version, adapters:[...]}). Older agents
    // omit it; the GCS defaults to a safe undefined.
    macStability: v.optional(v.any()),
    // Operator management-link health (object {state, iface, transport,
    // backend, carrier, hasLease, gatewayReachable, repairing, lastRung,
    // lastRepairAt, repairsInWindow}). Stored free-form so the shape extends
    // additively. Older agents omit it; the GCS defaults to undefined.
    managementLink: v.optional(v.any()),
    // Per-interface WiFi power-save reconciler verdicts (object
    // {interfaces:[...]}). Stored free-form so the shape extends additively.
    // Older agents omit it; the GCS defaults to a safe undefined.
    wifiPowersave: v.optional(v.any()),
    // Management-link reach-back mode + failover interface/reason. Older agents
    // omit these; the GCS treats absence as "primary".
    mgmtLinkMode: v.optional(v.string()),
    mgmtFailoverIface: v.optional(v.union(v.string(), v.null())),
    mgmtFailoverReason: v.optional(v.union(v.string(), v.null())),
    // USB-rehome self-heal state + attempt count + last outcome. Older agents
    // omit these.
    usbRehomeState: v.optional(v.string()),
    usbRehomeAttempts: v.optional(v.union(v.number(), v.null())),
    usbRehomeLastResult: v.optional(v.union(v.string(), v.null())),
    installStatus: v.optional(v.string()),
    installVersion: v.optional(v.string()),
    failedSteps: v.optional(v.array(v.string())),
    cpuPercent: v.optional(v.number()),
    memoryPercent: v.optional(v.number()),
    diskPercent: v.optional(v.number()),
    temperature: v.optional(v.float64()),
    fcConnected: v.optional(v.boolean()),
    fcPort: v.optional(v.string()),
    fcBaud: v.optional(v.number()),
    // Gated MAVLink truth — siblings of fcConnected. transportOpen = the
    // serial/udp/tcp transport is open; mavlinkAlive = a HEARTBEAT was decoded
    // within the agent's freshness window; heartbeatAgeS = seconds since the
    // last one; fcSource = which source the router resolved; fcLinkHint = a
    // diagnostic hint for a not-alive link ("none" | "msp_detected" |
    // "no_heartbeat") that drives the GCS remediation message. All optional so
    // an agent that predates the gated truth round-trips cleanly.
    transportOpen: v.optional(v.boolean()),
    mavlinkAlive: v.optional(v.boolean()),
    heartbeatAgeS: v.optional(v.number()),
    fcSource: v.optional(v.string()),
    fcLinkHint: v.optional(v.string()),
    // FC protocol family the agent identified ("betaflight" | "inav" for an
    // MSP FC), so a cloud-relayed MSP FC drives the MSP adapter + MSP relay
    // lane the same way the LAN-direct path does. Optional so an agent that
    // predates the field round-trips cleanly.
    fcVariant: v.optional(v.string()),
    // Canonical FC firmware family ("ardupilot" | "px4" | "betaflight" | "inav")
    // so a cloud-relay GCS can badge the family, including ArduPilot vs PX4 which
    // fcVariant cannot distinguish. Optional for older agents.
    fcFirmware: v.optional(v.string()),
    // fcReachable = honest connected-or-reachable verdict (true for a healthy
    // MSP FC that never emits the HEARTBEAT the alive gate needs). Emitted as
    // a plain boolean on every packaged-loop heartbeat, so a validator that
    // omits it rejects the entire heartbeat. Optional for older agents.
    fcReachable: v.optional(v.boolean()),
    // Absolute resource values
    memoryUsedMb: v.optional(v.number()),
    memoryTotalMb: v.optional(v.number()),
    // Detailed memory breakdown: available, page-cache, and swap.
    memoryAvailableMb: v.optional(v.number()),
    memoryCacheMb: v.optional(v.number()),
    swapTotalMb: v.optional(v.number()),
    swapUsedMb: v.optional(v.number()),
    swapPercent: v.optional(v.number()),
    diskUsedGb: v.optional(v.number()),
    diskTotalGb: v.optional(v.number()),
    cpuCores: v.optional(v.number()),
    boardRamMb: v.optional(v.number()),
    // Process-level totals
    processCpuPercent: v.optional(v.number()),
    processMemoryMb: v.optional(v.number()),
    // History arrays for sparkline charts
    cpuHistory: v.optional(v.array(v.number())),
    memoryHistory: v.optional(v.array(v.number())),
    services: v.optional(v.array(v.object({
      name: v.string(),
      status: v.string(),
      cpuPercent: v.optional(v.number()),
      memoryMb: v.optional(v.number()),
      uptimeSeconds: v.optional(v.number()),
      pid: v.optional(v.number()),
      category: v.optional(v.string()),
    }))),
    lastIp: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    setupUrl: v.optional(v.string()),
    apiUrl: v.optional(v.string()),
    missionControlUrl: v.optional(v.string()),
    // Video pipeline status for GCS auto-discovery
    videoState: v.optional(v.string()),
    videoWhepPort: v.optional(v.number()),
    videoWhepUrl: v.optional(v.string()),
    videoStreams: v.optional(
      v.array(
        v.object({
          id: v.string(),
          role: v.optional(v.string()),
          codec: v.optional(v.string()),
          live: v.optional(v.boolean()),
        }),
      ),
    ),
    videoRestartAttempts: v.optional(v.number()),
    mavlinkWsPort: v.optional(v.number()),
    mavlinkWsUrl: v.optional(v.string()),
    mavlinkWsUrlPrev: v.optional(v.string()),
    manualConnectionUrls: v.optional(
      v.object({
        mavlinkTcp: v.optional(v.union(v.string(), v.null())),
        mavlinkWs: v.optional(v.union(v.string(), v.null())),
        mavlinkWsAuthenticated: v.optional(v.union(v.string(), v.null())),
        videoViewer: v.optional(v.union(v.string(), v.null())),
        videoWhep: v.optional(v.union(v.string(), v.null())),
      }),
    ),
    cloudRelayUrl: v.optional(v.union(v.string(), v.null())),
    cloudflareUrl: v.optional(v.union(v.string(), v.null())),
    cloudPosture: v.optional(v.string()),
    pluginInventory: v.optional(
      v.array(
        v.object({
          plugin_id: v.string(),
          version: v.optional(v.union(v.string(), v.null())),
          status: v.optional(v.union(v.string(), v.null())),
          // Per-model delivery outcome (resolved / needs_model / verify_failed),
          // one entry per declared model id. Additive + optional.
          model_status: v.optional(
            v.array(
              v.object({
                state: v.string(),
                model_id: v.string(),
                runtime: v.optional(v.union(v.string(), v.null())),
                path: v.optional(v.union(v.string(), v.null())),
                reason: v.optional(v.union(v.string(), v.null())),
              }),
            ),
          ),
          // Per-service readiness (ready + reason), one entry per declared
          // service. Additive + optional.
          service_status: v.optional(
            v.array(
              v.object({
                name: v.string(),
                ready: v.boolean(),
                reason: v.optional(v.union(v.string(), v.null())),
              }),
            ),
          ),
        }),
      ),
    ),
    peripheralStates: v.optional(
      v.array(
        v.object({
          id: v.string(),
          connected: v.boolean(),
          last_seen: v.optional(v.union(v.number(), v.null())),
        }),
      ),
    ),
    remoteAccess: v.optional(v.any()),
    peripherals: v.optional(v.any()),
    scripts: v.optional(v.any()),
    enrollment: v.optional(v.any()),
    peers: v.optional(v.any()),
    telemetry: v.optional(v.any()),
    logs: v.optional(v.any()),
    runtimeMode: v.optional(v.string()),
    // Wire-contract identity for the Command-tab node hub. "profile"
    // is "drone" or "ground-station"; "role" is "direct" | "relay" |
    // "receiver" on a ground station, null on a drone. Older agents
    // that don't emit these fields default the GCS to "drone".
    profile: v.optional(v.string()),
    role: v.optional(v.string()),
    wfbFailoverState: v.optional(v.string()),
    // Ground-station cloud-relay state from the uplink-aware relay bridge.
    // All optional so the drone heartbeat (and a GS with no active uplink)
    // round-trip cleanly. NOTE: this OSS-twin /agent/status route PICKS fields
    // explicitly (it does not spread the body like the production deployment),
    // so each of these is also listed in http.ts's statusPayload pick list.
    uplink: v.optional(v.string()),
    mqttConnected: v.optional(v.boolean()),
    throttleState: v.optional(v.string()),
    forwardingVideo: v.optional(v.boolean()),
    forwardingTelemetry: v.optional(v.boolean()),
    tsMs: v.optional(v.number()),
    // NPU capability the board declares: npuTops (declared TOPS, 0 when none)
    // + hasAccelerator. Siblings of perceptionTier from the same heartbeat
    // surface; the agent emits both as plain scalars on EVERY heartbeat, so a
    // validator that omits them rejects the entire heartbeat. Optional so an
    // agent that predates the surface round-trips cleanly.
    npuTops: v.optional(v.number()),
    hasAccelerator: v.optional(v.boolean()),
    // Perception tier + the offload target (host:port) this node reports, mirror
    // of the native /api/status so the LAN and cloud surfaces agree. Absent on an
    // agent that predates the surface. This OSS-twin /agent/status route PICKS
    // fields explicitly, so each is also listed in http.ts's statusPayload.
    perceptionTier: v.optional(v.string()),
    perceptionOffloadTarget: v.optional(v.string()),
    // Compute-node cluster + job-queue telemetry from a compute-profile agent.
    // All optional so the drone/GS heartbeat round-trips cleanly; persisted
    // verbatim via the args spread. "computeActiveSessions" is the count of live
    // streaming perception-offload sessions the node serves. This OSS-twin
    // /agent/status route PICKS fields explicitly, so each is also listed in
    // http.ts's statusPayload.
    computeRole: v.optional(v.string()),
    computeClusterMasterId: v.optional(v.string()),
    computeQueueDepth: v.optional(v.number()),
    computeActiveJobs: v.optional(v.number()),
    computeActiveSessions: v.optional(v.number()),
    computeWorkersIdle: v.optional(v.number()),
    computeClusterAggregateWorkersIdle: v.optional(v.number()),
    computeClusterSlaves: v.optional(
      v.array(
        v.object({
          nodeId: v.string(),
          accelerators: v.array(v.string()),
          workersIdle: v.number(),
          queueDepth: v.number(),
        }),
      ),
    ),
    // Generic plugin-state channel: { "<plugin id>": <opaque slice> }. A plugin
    // surfaces its own telemetry (e.g. Atlas under pluginState.atlas) without
    // core columns. The OSS-twin /agent/status route picks this one field; the
    // slice is opaque (the plugin owns it).
    pluginState: v.optional(v.record(v.string(), v.any())),
    setupState: v.optional(v.string()),
    profileSource: v.optional(v.string()),
    // Top-level mirror of the selected WFB radio adapter (also nested in
    // the radio block below). Optional so older agents round-trip
    // cleanly; persisted verbatim via the args spread in the handler.
    wfbAdapterChipset: v.optional(v.union(v.string(), v.null())),
    wfbAdapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
    // USB link health of the selected adapter, mirrored at the top level
    // (also nested in the radio block below at adapterUsbDegraded/
    // adapterUsbSpeedMbps). The HTTP relay forwards these two as top-level
    // fields; a strict args validator that omits them throws inside
    // runMutation and fails the ENTIRE heartbeat the moment an agent emits a
    // real bool/number. Declared here (the schema already carries them) so
    // they round-trip. Optional + nullable: older agents omit them.
    wfbAdapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
    wfbAdapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
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
      homeChannel: v.optional(v.union(v.number(), v.null())),
      band: v.optional(v.union(v.string(), v.null())),
      regDomain: v.optional(v.union(v.string(), v.null())),
      // Operating-region posture. regPosture "unrestricted" | "region";
      // pinnedRegion is the pinned ISO 3166-1 alpha-2 code; regVerified is
      // true once a pinned region is confirmed effective. Optional +
      // nullable: older agents omit them.
      regPosture: v.optional(v.union(v.string(), v.null())),
      pinnedRegion: v.optional(v.union(v.string(), v.null())),
      regVerified: v.optional(v.union(v.boolean(), v.null())),
      monitorActive: v.optional(v.union(v.boolean(), v.null())),
      txActive: v.optional(v.union(v.boolean(), v.null())),
      peerLink: v.optional(v.union(v.string(), v.null())),
      hopState: v.optional(v.union(v.string(), v.null())),
      snrDb: v.optional(v.union(v.number(), v.null())),
      noiseDbm: v.optional(v.union(v.number(), v.null())),
      lossPercent: v.optional(v.union(v.number(), v.null())),
      mcsIndex: v.optional(v.union(v.number(), v.null())),
      rxSilentSeconds: v.optional(v.union(v.number(), v.null())),
      txVideoStalled: v.optional(v.union(v.boolean(), v.null())),
      txVideoStallKills: v.optional(v.union(v.number(), v.null())),
      txVideoRecvqBytes: v.optional(v.union(v.number(), v.null())),
      // Ground-side receive acquisition surface. acquireState is one of
      // "idle" | "searching" | "locked" | "no-peer"; channelLocked is
      // the boolean lock flag; reacquireKills counts destructive ground
      // wfb_rx restarts from the valid-packet watchdog; rxZombieKills
      // counts restarts the liveness watchdog fired because wfb_rx was
      // alive yet had stopped decoding (a process-silent stall, distinct
      // from a decode thrash); validRxPacketsPerS is the per-second valid
      // WFB decode rate on the ground. Optional + nullable: transmit-side
      // and older agents omit them.
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
      // Selected WFB adapter chipset + injection-capability flag.
      // adapterInjectionOk=false means no injection-capable adapter was
      // found and the agent refuses to transmit. Optional + nullable:
      // older agents omit them.
      adapterChipset: v.optional(v.union(v.string(), v.null())),
      adapterInjectionOk: v.optional(v.union(v.boolean(), v.null())),
      // Selected adapter's USB link health + the muted-PHY flag. A v.object()
      // rejects undeclared fields, so these must be allowed for the cloud relay
      // to accept the radio block (the agent emits them; they were previously
      // dropped here, silently failing the heartbeat when present).
      adapterUsbSpeedMbps: v.optional(v.union(v.number(), v.null())),
      adapterUsbDegraded: v.optional(v.union(v.boolean(), v.null())),
      phyMuted: v.optional(v.union(v.boolean(), v.null())),
      // Live radio tuning surface (matches schema): running FEC ratio, preset
      // name, adaptive-controller flag + its current ladder rung.
      fecK: v.optional(v.union(v.number(), v.null())),
      fecN: v.optional(v.union(v.number(), v.null())),
      linkPreset: v.optional(v.union(v.string(), v.null())),
      adaptiveBitrateEnabled: v.optional(v.union(v.boolean(), v.null())),
      recommendedTierIdx: v.optional(v.union(v.number(), v.null())),
      recommendedTierName: v.optional(v.union(v.string(), v.null())),
      recommendedBitrateKbps: v.optional(v.union(v.number(), v.null())),
      // Radio-data-plane churn + transmit-rate observability (matches schema).
      txZombieKills: v.optional(v.union(v.number(), v.null())),
      txBytesPerS: v.optional(v.union(v.number(), v.null())),
      restartCount: v.optional(v.union(v.number(), v.null())),
      paired: v.optional(v.boolean()),
      pairedWithDeviceId: v.optional(v.union(v.string(), v.null())),
      pairedAt: v.optional(v.union(v.string(), v.null())),
      publicKeyFingerprint: v.optional(v.union(v.string(), v.null())),
      autoPairEnabled: v.optional(v.union(v.boolean(), v.null())),
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
    // Local SPI LCD surface state (matches schema.ts cmd_droneStatus).
    lcdActivePage: v.optional(v.string()),
    lcdTouchCalibrated: v.optional(v.boolean()),
    lcdRotation: v.optional(v.number()),
    lcdSnapshotUrl: v.optional(v.string()),
    lcdLastTouchAt: v.optional(v.number()),
    lcdLastGesture: v.optional(v.string()),
    // Local on-board video surface (LCD video page tap + recording).
    videoLocalDecoderActive: v.optional(v.boolean()),
    videoLocalDecoderType: v.optional(v.string()),
    videoLocalDecoderFps: v.optional(v.number()),
    videoRecording: v.optional(v.boolean()),
    // Operator-selected UI theme on the agent.
    uiTheme: v.optional(v.string()),
    // Effective primary local-display path resolved each heartbeat
    // ("hdmi" | "lcd" | "none"). Reflects the ground_station.display.type
    // config when explicit; resolved by HDMI / LCD probe when "auto".
    displayType: v.optional(v.string()),
    // Epoch ms of the last plugin-update registry sweep on the agent.
    last_plugin_update_check_at: v.optional(v.number()),
    // Inter-rig peer presence — sourced from the agent's HopListener
    // peer cache (WFB-radio PresenceBeacon stream). Drone heartbeats
    // carry the GS's identity; GS heartbeats carry the drone's.
    peerDeviceId: v.optional(v.union(v.string(), v.null())),
    peerRole: v.optional(v.union(v.string(), v.null())),
    peerChannel: v.optional(v.union(v.number(), v.null())),
    peerRssiDbm: v.optional(v.union(v.number(), v.null())),
    peerSeenAtUnix: v.optional(v.union(v.number(), v.null())),
    // The LIST of WFB peers a ground station relays. A GS can be linked to
    // more than one drone, which the scalar peer* fields above cannot carry;
    // this is the list a GCS paired only to the ground node reads to enrol
    // each drone. Each entry carries only what the beacon + listener decode.
    // The inner v.object is strict, so it declares exactly the producer's
    // camelCase key set; an undeclared key would reject the whole heartbeat.
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
    // Primary camera discovery state — "ready" | "missing" | "error".
    cameraState: v.optional(v.union(v.string(), v.null())),
    // USB camera-recovery self-heal state from the air-side reconciler.
    // state is "idle" | "monitoring" | "rebinding" | "port_cycling" |
    // "hub_resetting" | "needs_hub_reset" | "guard_blocked" | "exhausted";
    // `case` is the agent's diagnosis string (or null); the remaining fields
    // bound the recovery episode. Inner fields are optional + nullable so a
    // slightly older agent payload still round-trips. Without this
    // declaration the strict validator would reject the whole heartbeat once
    // the relay forwards the object. Consumed by the GCS capability store.
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
    // FC CAN bus configuration harvested from the persisted parameter
    // cache. The agent emits an array of {port, driver, bitrate,
    // protocol} entries once the cache holds at least one CAN_P*_*
    // value. Absent during the warmup window between FC connect and
    // the first parameter download finishing. Forwarded straight to
    // the cloud row so the GCS can render the per-port configuration
    // on the drone card without re-querying the FC.
    canBuses: v.optional(v.array(v.object({
      port: v.number(),
      driver: v.number(),
      bitrate: v.number(),
      protocol: v.number(),
    }))),
    // Vision engine summary (see schema.ts cmd_droneStatus comment).
    // Active model id + inference backend + rolling throughput. All
    // optional so an agent that predates the vision surface round-trips
    // cleanly.
    visionActiveModel: v.optional(v.union(v.string(), v.null())),
    visionBackend: v.optional(v.union(v.string(), v.null())),
    visionDetectionsPerSec: v.optional(v.number()),
    visionFps: v.optional(v.number()),
    // Per-service config-load errors. Each entry names a service whose config
    // file failed to parse (the agent kept running on defaults). Present only
    // for services in an errored state; absent when every config loaded
    // cleanly. This OSS-twin /agent/status route PICKS fields explicitly, so
    // this is also listed in http.ts's statusPayload pick list.
    configErrors: v.optional(
      v.array(
        v.object({
          service: v.string(),
          error: v.string(),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    const now = Date.now();

    // Local display + theme fields are forwarded through the same args
    // spread, but pinned here explicitly so a future refactor that
    // narrows the spread cannot silently drop the LCD/theme surface.
    const localSurfaceFields = {
      lcdActivePage: args.lcdActivePage,
      lcdTouchCalibrated: args.lcdTouchCalibrated,
      lcdRotation: args.lcdRotation,
      lcdSnapshotUrl: args.lcdSnapshotUrl,
      lcdLastTouchAt: args.lcdLastTouchAt,
      lcdLastGesture: args.lcdLastGesture,
      videoLocalDecoderActive: args.videoLocalDecoderActive,
      videoLocalDecoderType: args.videoLocalDecoderType,
      videoLocalDecoderFps: args.videoLocalDecoderFps,
      videoRecording: args.videoRecording,
      uiTheme: args.uiTheme,
      displayType: args.displayType,
      last_plugin_update_check_at: args.last_plugin_update_check_at,
    };

    if (existing) {
      await ctx.db.patch(existing._id, {
        ...args,
        ...localSurfaceFields,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("cmd_droneStatus", {
        ...args,
        ...localSurfaceFields,
        updatedAt: now,
      });
    }

    // Derive attached display type from peripherals[] for the
    // fleet card pill. The agent reports the SPI LCD as a peripheral
    // entry with category="display"; we cherry-pick the type so the
    // drone card can render an "LCD" badge without re-querying the
    // full status row.
    let attachedDisplayType: string | undefined;
    if (Array.isArray(args.peripherals)) {
      const display = (args.peripherals as Array<Record<string, unknown>>).find(
        (p) => p && (p as { category?: unknown }).category === "display",
      );
      if (display && typeof display.type === "string") {
        attachedDisplayType = display.type;
      }
    }

    // Direct LAN MAVLink URL denormalized onto cmd_drones so the
    // fleet card can render a "Direct" pill without joining
    // cmd_droneStatus on every render.
    let manualMavlinkWsUrl: string | undefined;
    if (args.manualConnectionUrls && typeof args.manualConnectionUrls === "object") {
      const ws = (args.manualConnectionUrls as { mavlinkWs?: unknown }).mavlinkWs;
      if (typeof ws === "string" && ws.length > 0) {
        manualMavlinkWsUrl = ws;
      }
    }

    // Also update the cmd_drones table lastSeen, fcConnected, lastIp
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (drone) {
      await ctx.db.patch(drone._id, {
        lastSeen: now,
        fcConnected: args.fcConnected,
        lastIp: args.lastIp,
        mdnsHost: args.mdnsHost,
        ...(args.runtimeMode !== undefined ? { runtimeMode: args.runtimeMode } : {}),
        ...(attachedDisplayType !== undefined
          ? { attachedDisplayType }
          : {}),
        ...(args.profileSource !== undefined
          ? { profileSource: args.profileSource }
          : {}),
        ...(args.profile !== undefined ? { profile: args.profile } : {}),
        ...(args.role !== undefined ? { role: args.role } : {}),
        ...(manualMavlinkWsUrl !== undefined ? { manualMavlinkWsUrl } : {}),
        ...(args.peerDeviceId !== undefined
          ? { peerDeviceId: args.peerDeviceId }
          : {}),
        ...(args.peerRssiDbm !== undefined
          ? { peerRssiDbm: args.peerRssiDbm }
          : {}),
        ...(args.cameraState !== undefined
          ? { cameraState: args.cameraState }
          : {}),
        ...(args.fcLinkHint !== undefined
          ? { fcLinkHint: args.fcLinkHint }
          : {}),
        ...(args.cloudPosture !== undefined
          ? { cloudPosture: args.cloudPosture }
          : {}),
        // (cameraState + fcLinkHint + cloudPosture denormalized above for the
        // fleet card)
      });
    }

    return { ok: true };
  },
});

/**
 * Get cloud status for a specific drone.
 */
export const getCloudStatus = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    await requireOwnedDroneByDeviceId(ctx, deviceId);
    return await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
  },
});

/**
 * List display-safe cloud status rows for every drone paired to the
 * authenticated user. Pair keys are intentionally not returned.
 */
export const listMyCloudStatuses = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const drones = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();

    return await Promise.all(
      drones.map(async (drone) => {
        const status = await ctx.db
          .query("cmd_droneStatus")
          .withIndex("by_deviceId", (q) => q.eq("deviceId", drone.deviceId))
          .first();

        return {
          drone: {
            _id: drone._id,
            userId: drone.userId,
            deviceId: drone.deviceId,
            name: drone.name,
            agentVersion: drone.agentVersion,
            board: drone.board,
            tier: drone.tier,
            os: drone.os,
            mdnsHost: drone.mdnsHost,
            lastIp: drone.lastIp,
            lastSeen: drone.lastSeen,
            fcConnected: drone.fcConnected,
            pairedAt: drone.pairedAt,
          },
          status,
        };
      }),
    );
  },
});
