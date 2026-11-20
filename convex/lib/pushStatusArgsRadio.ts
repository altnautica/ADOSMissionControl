/**
 * @module convex/lib/pushStatusArgsRadio
 * @description `pushStatus` heartbeat args: radio and CRSF control-lane blocks.
 * Spread into `pushStatusArgs`; see `./pushStatusArgs`.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";

export const radioStatusArgs = {
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
    // The auto-pair re-arm this rig's key last took (agent `pair_rearm`):
    // why (`unproven` / `mis_keyed` / `forced`), when, how many, and whether
    // its bind window still runs. Absent when the key was never re-armed.
    pairRearm: v.optional(v.union(v.object({
      cause: v.union(v.string(), v.null()),
      at: v.number(),
      episodes: v.number(),
      active: v.boolean(),
    }), v.null())),
    // A fleet slot delivered to the vehicle and the radio restart it is owed
    // (agent `fleet_apply`): `deferred_armed` while it waits for the vehicle
    // to disarm. Absent when no address was written this boot.
    fleetApply: v.optional(v.union(v.object({
      outcome: v.string(),
      fleetId: v.union(v.number(), v.null()),
      fleetSlot: v.union(v.number(), v.null()),
      sinceMs: v.union(v.number(), v.null()),
      atMs: v.union(v.number(), v.null()),
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
};
