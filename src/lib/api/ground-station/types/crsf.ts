/**
 * @module api/ground-station/types/crsf
 * @description CRSF / ExpressLRS control-lane snapshot, normalized to
 * camelCase. The ados-crsf service writes a snake_case "crsf-stats" sidecar;
 * two producers surface it to Mission Control, and they carry DIFFERENT field
 * sets:
 *   - the cloud heartbeat (camelCase, a projection that drops `flyable` + `pic`
 *     and carries no usable TX power — its `txPowerDbm` is always null), and
 *   - the LAN `GET /api/v1/ground-station/crsf` route (the raw snake_case
 *     sidecar: every field, including `tx_power_mw` + `flyable` + `pic`).
 * The capability-store normalizer folds either casing onto this shape.
 *
 * @license GPL-3.0-only
 */

// Coarse control-lane state — the ados-crsf service's own vocabulary.
// "unconfigured" = no ELRS transmitter bound yet; "ready" = bound but idle;
// "link_ok" = commanding a peer; "degraded" = link up but marginal;
// "rf_unverified" = transmitting while no reception has been confirmed (neither
// up nor down — frames leave the module but nothing proves a peer heard them,
// so it must be read as itself, never as connected); "disabled" = the lane is
// turned off.
export type CrsfLinkState =
  | "unconfigured"
  | "ready"
  | "link_ok"
  | "degraded"
  | "rf_unverified"
  | "disabled";

export interface CrsfState {
  // Coarse lane state. Null when the block carries no verdict yet (the sidecar
  // may send state:null) or an unknown string — never fabricated. A wholly
  // absent lane is the `crsf` store field itself being null, not a state
  // sentinel, so there is no "absent" member here.
  state: CrsfLinkState | null;
  // ExpressLRS link statistics (CRSF Link-Stats 0x14). Null when unmeasured, on
  // the wrong casing, or absent — never a fabricated 0.
  rssiDbm: number | null;
  lqUplink: number | null;
  lqDownlink: number | null;
  snrDb: number | null;
  // Band descriptor (900 / 2.4 / dual-band). Null when not reported.
  band: string | null;
  packetRateHz: number | null;
  // Transmit power in milliwatts. Carried ONLY by the LAN sidecar
  // (`tx_power_mw`); the cloud heartbeat's `txPowerDbm` is always null (the
  // projection reads a field the sidecar never emits), so over the heartbeat
  // this stays null — the honest reading, since the heartbeat carries no usable
  // TX power. Read the real TX power from the LAN route.
  txPowerMw: number | null;
  // Transmit / receive CRSF frame rates from the lane's liveness watchdog.
  txFramesPerS: number | null;
  rxFramesPerS: number | null;
  // Transmit-proof verdict: true when frames leave the module but no reception
  // has been confirmed. Tri-state — null means NO VERDICT (absent, or not yet),
  // never a fabricated false, which would assert the transmit path was proven.
  rfUnverified: boolean | null;
  // Arm-safety verdict (true only for link_ok / degraded). LAN-sidecar only;
  // the heartbeat projection drops it, so it is null over the cloud path / on
  // older agents rather than a fabricated false.
  flyable: boolean | null;
  // Control mode (CRSF RC-channel injection vs MAVLink-over-ExpressLRS). Null
  // when not reported.
  mode: string | null;
  // MAVLink-over-ExpressLRS command-down gate. When the lane runs
  // MAVLink-over-ELRS the full-bidirectional flight-controller command path is
  // held behind a safety gate: telemetry flows down but commands are NOT
  // delivered to the FC until that gate is lifted. `true` = command path gated
  // (telemetry-only), so a surface must not imply commands reach the FC.
  // `false` = the command path is open. Tri-state — null means NO VERDICT
  // (absent, an older agent, or a lane not running MAVLink-over-ELRS), never a
  // fabricated false, which would assert the command path was open. Carried on
  // BOTH casings (a safety gate must be visible on every reach path, so unlike
  // flyable / pic the heartbeat projection keeps it).
  fcCommandDownGated: boolean | null;
  // Where the RC channels originate (handset joystick / injection API /
  // virtual sticks). Null when not reported.
  channelSource: string | null;
  // Pilot-in-command arbiter. LAN-sidecar only; the heartbeat projection drops
  // it, so it is null over the cloud path.
  pic: string | null;
  // Relay role when this node relays control to another drone. Null when not
  // relaying / not reported.
  relayRole: string | null;
}
