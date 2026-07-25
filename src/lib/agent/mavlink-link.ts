/**
 * @module agent/mavlink-link
 * @description Derives the truthful MAVLink-link state from an `AgentStatus`.
 *
 * The agent's `fc_connected` historically meant only "transport open" — a
 * fixed serial port opens and the field flips true even if no HEARTBEAT is
 * ever decoded, so a broken link still reads "connected" (the user-reported
 * bug). Newer agents publish the gated truth as siblings: `transport_open`
 * (port is open), `mavlink_alive` (a HEARTBEAT decoded inside the freshness
 * window), and `heartbeat_age_s`. This helper folds those into one of three
 * states the UI renders distinctly:
 *
 *   - `alive`   — transport open AND a fresh HEARTBEAT (the real connected)
 *   - `silent`  — transport open but NO MAVLink (amber "Port open · no MAVLink")
 *   - `down`    — no transport (red "FC Disconnected")
 *
 * On an older agent that only ships `fc_connected`, we fall back to it: true →
 * `alive`, false → `down` (it can never report the `silent` state, which is
 * fine — that distinction is exactly what the newer agents add).
 *
 * @license GPL-3.0-only
 */

import type { AgentStatus } from "./types";
import { isMspVariant } from "@/lib/protocol/select-fc-adapter";
import { fcFirmwareLabel } from "@/lib/protocol/fc-firmware-label";

export type MavlinkLinkState = "alive" | "msp" | "silent" | "down";

export interface MavlinkLink {
  state: MavlinkLinkState;
  /** True when the transport (serial/udp/tcp) is open. */
  transportOpen: boolean;
  /** True when a HEARTBEAT was decoded within the agent's freshness window. */
  mavlinkAlive: boolean;
  /** Seconds since the last decoded HEARTBEAT, or null when unknown / none. */
  heartbeatAgeS: number | null;
  /** True when the agent ships the gated fields (so the UI can show age). */
  hasGatedTruth: boolean;
  /** The identified MSP variant ("betaflight" | "inav"), when the FC is an MSP
   * board. Drives the connected-style "Betaflight (MSP)" badge for the `msp`
   * state — an MSP FC is reachable and drivable, it just speaks MSP not MAVLink,
   * so it is NOT the amber "silent / port open no MAVLink" state. */
  fcVariant: string | null;
}

/** Pull a number out of an unknown, else null. */
function asNum(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Derive the link state from an agent status. Pure; safe in tests and render.
 * `status` may be a legacy shape (only `fc_connected`) or the gated shape.
 */
export function deriveMavlinkLink(
  status:
    | Pick<
        AgentStatus,
        | "fc_connected"
        | "transport_open"
        | "mavlink_alive"
        | "heartbeat_age_s"
        | "fc_variant"
      >
    | null
    | undefined,
): MavlinkLink {
  const transportOpenRaw =
    status && typeof status.transport_open === "boolean"
      ? status.transport_open
      : undefined;
  const mavlinkAliveRaw =
    status && typeof status.mavlink_alive === "boolean"
      ? status.mavlink_alive
      : undefined;
  const heartbeatAgeS = status ? asNum(status.heartbeat_age_s) : null;
  const fcVariant =
    status && typeof status.fc_variant === "string" ? status.fc_variant : null;
  const isMsp = isMspVariant(fcVariant);
  const hasGatedTruth =
    transportOpenRaw !== undefined || mavlinkAliveRaw !== undefined;

  if (!hasGatedTruth) {
    // Legacy agent: fc_connected is the only signal. true → alive, false → down.
    const connected = status?.fc_connected === true;
    return {
      state: connected ? "alive" : "down",
      transportOpen: connected,
      mavlinkAlive: connected,
      heartbeatAgeS,
      hasGatedTruth: false,
      fcVariant,
    };
  }

  // Gated agent: prefer the explicit fields. The transport is open if either
  // the explicit flag says so OR the gated fc_connected (which is already
  // transport && alive) is true. The link is alive only on the explicit
  // mavlink_alive flag (never inferred from a stale port-open).
  const transportOpen =
    transportOpenRaw ?? (mavlinkAliveRaw === true || status?.fc_connected === true);
  const mavlinkAlive = mavlinkAliveRaw ?? false;

  // An identified MSP FC (Betaflight/iNav) with the transport open is reachable
  // and drivable over the MSP proxy — it just never emits a MAVLink heartbeat,
  // so it is a first-class `msp` state, NOT the amber "silent / port open, no
  // MAVLink" that a genuinely-broken MAVLink link produces.
  const state: MavlinkLinkState = mavlinkAlive
    ? "alive"
    : isMsp && transportOpen
      ? "msp"
      : transportOpen
        ? "silent"
        : "down";

  return { state, transportOpen, mavlinkAlive, heartbeatAgeS, hasGatedTruth, fcVariant };
}

/**
 * Whether the agent's FC is reachable and drivable, folding the two honest
 * connected cases into one predicate: a MAVLink FC that reports `fcConnected`
 * (transport open AND a HEARTBEAT gated it true), OR an identified MSP FC
 * (Betaflight/iNav) with the serial transport open. An MSP FC never emits a
 * MAVLink heartbeat, so it can never set `fcConnected` — but it IS reachable
 * and drivable over the byte-transparent proxy with the MSP adapter, so it must
 * read as connected, not "no FC". Accepts the normalised camelCase fields the
 * fleet projection and stores carry. Pure; safe in render and tests.
 */
export function isFcReachable(fc: {
  fcConnected?: boolean | null;
  fcVariant?: string | null;
  transportOpen?: boolean | null;
  /** The agent's own verdict, when it supplies one. Authoritative: the agent
   * can see its serial ports and we cannot, so a true here outranks our own
   * inference from the individual fields. */
  fcReachable?: boolean | null;
}): boolean {
  return (
    fc.fcReachable === true ||
    fc.fcConnected === true ||
    (isMspVariant(fc.fcVariant) && fc.transportOpen === true)
  );
}

/**
 * The connected-style label for an identified MSP flight controller, e.g.
 * "Betaflight (MSP)". Returns null unless the link is in the `msp` state, so a
 * caller renders it exactly when one applies and falls through to its normal
 * MAVLink wording otherwise. An MSP FC is reachable and drivable but never
 * emits a MAVLink heartbeat, so it carries its own label rather than the
 * MAVLink "connected" wording or the amber "no MAVLink" warning.
 *
 * When the firmware family is not identified the label degrades to a bare
 * "FC (MSP)" — the MSP state is established by the transport and variant, so
 * saying so is honest, while naming a family we could not read would not be.
 */
export function mspFcLabel(
  state: MavlinkLinkState,
  fcFirmware: string | null | undefined,
  fcVariant: string | null | undefined,
): string | null {
  if (state !== "msp") return null;
  return `${fcFirmwareLabel(fcFirmware, fcVariant) ?? "FC"} (MSP)`;
}

/** Human-readable heartbeat-age label, e.g. "1.2s ago" or "—". */
export function heartbeatAgeLabel(ageS: number | null): string {
  if (ageS == null || !Number.isFinite(ageS) || ageS < 0) return "—";
  if (ageS < 10) return `${ageS.toFixed(1)}s ago`;
  if (ageS < 120) return `${Math.round(ageS)}s ago`;
  return `${Math.round(ageS / 60)}m ago`;
}

/**
 * An actionable remediation message for a not-alive FC link, keyed for i18n.
 * `key` is a translation key under the `agent` namespace; `values` carries
 * any interpolation values (e.g. the FC port). Render with
 * `t(remediation.key, remediation.values)`.
 */
export interface FcLinkRemediation {
  key: string;
  values?: Record<string, string>;
}

/**
 * Derive an actionable remediation message from the agent's diagnostic
 * `fc_link_hint`. Returns null when there is nothing useful to say (the link
 * is fine, or the agent did not report a recognised hint). Pure; safe in tests
 * and render.
 *
 *   - `msp_detected` — an FC is on the port but speaking MSP, not MAVLink.
 *   - `no_heartbeat` — a port is open but no HEARTBEAT was decoded.
 *   - `source_unreachable` — the configured MAVLink source endpoint (a down /
 *     wrong tcp/udp host or an absent serial device) will not open.
 */
export function fcLinkRemediation(
  status:
    | { fc_link_hint?: string | null; fc_port?: string | null }
    | null
    | undefined,
): FcLinkRemediation | null {
  const hint = status?.fc_link_hint;
  if (hint === "source_unreachable") {
    return { key: "fcLink.remediation.sourceUnreachable" };
  }
  if (hint === "msp_detected") {
    return { key: "fcLink.remediation.mspDetected" };
  }
  if (hint === "no_heartbeat") {
    const port = status?.fc_port && status.fc_port.length > 0
      ? status.fc_port
      : "—";
    return { key: "fcLink.remediation.noHeartbeat", values: { port } };
  }
  return null;
}
