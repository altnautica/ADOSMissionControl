/**
 * @module AgentCapabilities/normalize-crsf
 * @description Forward-permissive normalizer for the CRSF / ExpressLRS
 * control-lane block.
 *
 * Split out of `normalizer.ts`. The block reaches the GCS from two producers
 * in two casings; every safety verdict it carries normalizes to null rather
 * than to a fabricated `false`, so an absent reading never reads as a proven
 * one.
 *
 * Pure: no Zustand access, no side effects.
 *
 * @license GPL-3.0-only
 */

import type {
  CrsfLinkState,
  CrsfState,
} from "@/lib/api/ground-station/types";

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
 * shape. The block reaches the GCS from two producers in two casings that carry
 * nearly the same field set:
 *   - the cloud heartbeat (camelCase `rssiDbm`, `txPowerMw`, ...; drops only
 *     `flyable` + `pic`), and
 *   - the LAN `GET /api/v1/ground-station/crsf` route (raw snake_case
 *     `rssi_dbm`, `tx_power_mw`, ...; carries `flyable` + `pic` too).
 * Both paths carry the real TX power and the `fc_command_down_gated` safety
 * gate. Each field is read from whichever casing is present. A missing block —
 * an older agent that never emits crsf, or a lane that is down / whose sidecar
 * is stale (the heartbeat omits the whole block, the LAN route 404s) — returns
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
    // TX power in mW, read from either casing (`tx_power_mw` on the LAN sidecar,
    // `txPowerMw` on the cloud heartbeat) so the real TX power surfaces on both
    // reach paths. Null when the lane reports no reading.
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
    // MAVLink-over-ELRS command-down safety gate. A safety verdict must travel
    // on every reach path, so it reads from either casing (unlike flyable / pic,
    // which the heartbeat projection drops). Anything that is not a real boolean
    // — absent, explicit null, a stale snapshot — normalizes to null ("no
    // verdict"). Defaulting to false would fabricate a claim that the FC command
    // path is open.
    fcCommandDownGated: bool(r.fcCommandDownGated ?? r.fc_command_down_gated),
    channelSource: str(r.channelSource ?? r.channel_source),
    // PIC arbiter, LAN-sidecar only (the heartbeat projection drops it).
    pic: str(r.pic),
    relayRole: str(r.relayRole ?? r.relay_role),
  };
}
