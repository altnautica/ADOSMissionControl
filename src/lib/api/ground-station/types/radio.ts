/**
 * @module api/ground-station/types/radio
 * @description Radio link snapshot, normalized to camelCase. The agent
 * emits the equivalent block as snake_case on the wire; the cloud relay
 * HTTP action and the local heartbeat decoder remap keys before this
 * shape reaches Mission Control state.
 *
 * @license GPL-3.0-only
 */

export type RadioLinkState =
  | "absent"
  | "disconnected"
  | "unpaired"
  | "auto_pairing"
  | "binding"
  | "connecting"
  | "connected"
  | "degraded";

export type RadioTopology = "host_vbus" | "powered_hub" | "external_5v";

// Peer-link rendezvous state, distinct from the overall link state. The
// drone and ground station both start on the fixed home channel; until a
// peer is heard the link sits in "searching". Once frames flow from the
// paired peer it reads "linked"; "no_peer" means the radio is up but no
// peer has ever been heard. Null on older agents that don't report it.
export type RadioPeerLink = "linked" | "searching" | "no_peer";

// Channel-hop supervisor state. Hopping is gated until the link is up:
// "idle" before the supervisor runs, "searching" while it sweeps for the
// peer on the home channel, "locked" once both sides agree on a channel,
// "hopping" during an in-progress move to a quieter channel.
export type RadioHopState = "idle" | "searching" | "locked" | "hopping";

// Ground receiver channel-acquirer mode. "idle" before acquisition runs,
// "searching" while it hunts for a valid-decode channel, "locked" once it
// settles on one, "no-peer" when the radio is up but no peer has been
// heard. Null on the transmit side and on older agents that don't report
// it.
export type RadioAcquireState = "idle" | "searching" | "locked" | "no-peer";

// WFB link-diagnosis verdict. Distinct from the coarse link state: it
// reasons over the received-frame counters to name WHY a link is not
// carrying payload. "healthy" = frames arrive and decode; "searching" =
// no peer heard yet; "deaf" = the receiver sees no RF at all (the local
// end injects but nothing comes back); "mis_keyed" = frames arrive but
// fail decrypt/FEC (a key or link-id mismatch); "jammed" = frames arrive
// but a high loss/error fraction points at interference. Null on older
// agents that don't report the verdict.
export type RadioLinkDiag =
  | "deaf"
  | "mis_keyed"
  | "jammed"
  | "healthy"
  | "searching";

export interface RadioState {
  state: RadioLinkState;
  iface: string | null;
  driver: string | null;
  channel: number | null;
  freqMhz: number | null;
  bandwidthMhz: number;
  txPowerDbm: number | null;
  txPowerMaxDbm: number;
  topology: RadioTopology;
  rssiDbm: number | null;
  bitrateKbps: number | null;
  fecRecovered: number;
  fecLost: number;
  packetsLost: number;
  // Fixed rendezvous channel both sides boot on before any hop. The
  // drone and ground station meet here first; only after the link is up
  // does the hop supervisor move them. Null on older agents.
  homeChannel: number | null;
  // Frequency band the link operates in (agent emits "u-nii-1" /
  // "u-nii-3" / "all"). Null when not reported.
  band: string | null;
  // Regulatory domain country code when one is set (e.g. "US"). Null
  // when the agent runs on the default world domain.
  regDomain: string | null;
  // Operating-region posture. `regPosture` is "unrestricted" when the
  // radio transmits without a pinned region (the operator is responsible
  // for local RF compliance) or "region" when an operating region is
  // pinned and the strict regulatory gate + legal power limit are in
  // force. `pinnedRegion` is the ISO 3166-1 alpha-2 code of the pinned
  // region (null under unrestricted). `regVerified` is true when a pinned
  // region has been confirmed effective at the driver/PHY layer, false
  // when pinned-but-not-yet-verified, and null when not applicable or not
  // reported. All three null on older agents that don't report them.
  regPosture: string | null;
  pinnedRegion: string | null;
  regVerified: boolean | null;
  // True when the radio interface is confirmed in monitor mode. Null on
  // older agents that don't assert it.
  monitorActive: boolean | null;
  // True when the drone is actually pushing frames over the air (the TX
  // watchdog sees the byte counter advancing), not merely that the
  // process is alive. Null on the receive side and on older agents.
  txActive: boolean | null;
  // Peer rendezvous state. Null on older agents.
  peerLink: RadioPeerLink | null;
  // Channel-hop supervisor state. Null on older agents.
  hopState: RadioHopState | null;
  // Receive-side link quality. Forwarded by newer agents on both the
  // transmit and receive sides; on a ground station these describe the
  // downlink it decodes. Null on older agents (the normalizer defaults
  // missing/non-finite values to null).
  snrDb: number | null;
  noiseDbm: number | null;
  lossPercent: number | null;
  mcsIndex: number | null;
  rxSilentSeconds: number | null;
  // Per-stream video-tx liveness. `txVideoStalled` flips true when the
  // agent's watchdog sees the video radio transmitter's ingress backlog
  // pinned while the process is alive (a silent video stall); the kill
  // counter and current backlog quantify it. Null on the receive side
  // and on older agents that don't report these fields.
  txVideoStalled: boolean | null;
  txVideoStallKills: number | null;
  txVideoRecvqBytes: number | null;
  // Ground-side receive acquisition surface. `acquireState` is the
  // channel-acquirer mode; `channelLocked` is its boolean lock flag.
  // `reacquireKills` counts destructive ground wfb_rx restarts the
  // valid-packet watchdog has fired — a climbing value means the receive
  // link is thrashing. `rxZombieKills` counts restarts the receive
  // liveness watchdog fired because wfb_rx was alive yet had stopped
  // decoding (rule 37) — a process-silent stall distinct from a decode
  // thrash. `validRxPacketsPerS` is the per-second valid WFB decode rate
  // on the ground. Null on the transmit side and on older agents that
  // don't report these fields.
  acquireState: RadioAcquireState | null;
  channelLocked: boolean | null;
  reacquireKills: number | null;
  rxZombieKills: number | null;
  validRxPacketsPerS: number | null;
  // WFB link diagnosis. `linkDiag` is the received-side verdict on why a
  // link is (or is not) carrying payload; `packetsAll` is the total RF
  // frames the receiver has seen (decoded or not) and `decryptErrors` is
  // the count that reached it but failed decrypt/FEC (a key / link-id
  // mismatch). All null on older agents that don't report them; the
  // normalizer preserves absence as null so the UI can skip a missing
  // reading rather than fabricate a verdict or a zero.
  linkDiag: RadioLinkDiag | null;
  packetsAll: number | null;
  decryptErrors: number | null;
  // Selected WFB radio adapter chipset (e.g. "RTL8812EU"). Null when the
  // agent could not identify the chipset, or on older agents that don't
  // report it.
  adapterChipset: string | null;
  // True when the selected radio adapter actually entered monitor mode
  // and is injection-capable. False when no injection-capable adapter was
  // found or verified (the agent then refuses to transmit, so the
  // operator sees no video with no other clue). Null on older agents that
  // don't assert it — the UI renders no adapter warning in that case.
  adapterInjectionOk: boolean | null;
  // USB link health of the selected adapter. `adapterUsbDegraded` is true when
  // the adapter enumerated on a slow (full-speed, 12 Mbps) USB link instead of
  // high-speed — a state where the driver advances its tx_bytes counter yet no
  // usable RF leaves the antenna. `adapterUsbSpeedMbps` is the enumerated speed
  // (12 / 480 / 5000). Both null on older agents that don't report them.
  adapterUsbDegraded: boolean | null;
  adapterUsbSpeedMbps: number | null;
  // Pair-state surface added in agent v0.16. Older agents omit
  // these fields; the normalizer falls back to safe defaults so
  // older heartbeats render as "unpaired" without crashes.
  paired: boolean;
  pairedWithDeviceId: string | null;
  pairedAt: string | null;
  publicKeyFingerprint: string | null;
  autoPairEnabled: boolean;
  // PHY at the muted txpower floor: the adapter injects frames yet
  // radiates nothing (txpower readback collapses toward the floor, carrier
  // down). The agent advances tx_bytes, so the link looks alive while no RF
  // leaves the antenna. Distinct from `adapterUsbDegraded` (a slow USB
  // enumeration) and `adapterInjectionOk` (no injection-capable adapter
  // found at all). Null on older agents that don't report it.
  phyMuted: boolean | null;
  // Live radio tuning surface. `fecK`/`fecN` are the data plane's running
  // Reed-Solomon ratio and `mcsIndex` (above) its running rate index — what the
  // transmitter is actually sending after a manual change or an automatic step,
  // not the configured value. `linkPreset` is the operator-facing preset name
  // ("conservative" / "balanced" / "aggressive") that seeded the trio.
  // `adaptiveBitrateEnabled` is true when the closed-loop FEC controller is
  // armed. The `recommendedTier*` fields describe the controller's current rung
  // on the bitrate/FEC ladder. All null on older agents that don't report them.
  fecK: number | null;
  fecN: number | null;
  linkPreset: string | null;
  adaptiveBitrateEnabled: boolean | null;
  recommendedTierIdx: number | null;
  recommendedTierName: string | null;
  recommendedBitrateKbps: number | null;
}

/** Response shape from PUT /api/wfb/tx-power. */
export interface SetTxPowerResult {
  requested_dbm: number;
  effective_dbm: number | null;
  tx_power_max_dbm: number;
}

/**
 * Response from POST /api/video/config (the drone agent's tuning route).
 * Mirrors GET /video/config plus a `warnings` array listing any knob the agent
 * could not apply live (e.g. the radio command socket was unreachable), so a
 * partial success is visible. Blocks are loosely typed: the tuning card reads
 * back the live values from the per-drone radio snapshot, not this response.
 */
export interface VideoConfigResponse {
  radio?: Record<string, unknown>;
  encoder?: Record<string, unknown>;
  adaptive?: Record<string, unknown>;
  hopping?: Record<string, unknown>;
  link?: Record<string, unknown>;
  warnings?: string[];
}
