/**
 * @module AgentCapabilities/normalize-radio
 * @description Forward-permissive normalizer for the on-wire WFB radio block.
 *
 * Split out of `normalizer.ts`: the radio block is the largest and most
 * legacy-shaped of the capability sub-blocks, and it changes on its own
 * schedule from the rest of the payload.
 *
 * Pure: no Zustand access, no side effects. Every recognized-literal set below
 * falls back to a safe default on an unknown value so a future agent that
 * ships an extension never crashes a surface.
 *
 * @license GPL-3.0-only
 */

import type {
  RadioAcquireState,
  RadioHopState,
  RadioLinkDiag,
  RadioLinkState,
  RadioPeerLink,
  RadioState,
  RadioTopology,
} from "@/lib/api/ground-station/types";

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
    mcsLadderCap: num(r.mcsLadderCap),
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
