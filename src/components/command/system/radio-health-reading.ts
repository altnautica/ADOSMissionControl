/**
 * @module command/system/radio-health-reading
 * @description Pure derivations behind the radio / network health panel's
 * live indicators: operating region, channel lock, RF link, radio stack,
 * management link, reach-back and USB rehome. Each takes the node's reported
 * fields and returns the pill text, tone and any note, so the panel only
 * renders. An absent field never becomes a healthy reading.
 *
 * @license GPL-3.0-only
 */

import type { AgentCapabilities } from "@/lib/agent/feature-types";
import type { RadioState } from "@/lib/api/ground-station/types";
import type { RadioNetworkActivity } from "@/lib/agent/radio-network-events";
import { resolveRfLink } from "./rf-link-reading";

export type PillTone = "success" | "warning" | "error" | "muted";

/** A conditional pill: `value` null means the pill is not shown. */
export interface OptionalPill {
  value: string | null;
  tone: "warning" | "error" | "success";
  /** Explanatory line shown under the pills, or null. */
  note: string | null;
}

const STACK_LABEL: Record<string, string> = {
  ok: "OK",
  no_injection: "No injection",
  unpaired: "Unpaired",
  no_bind_artifacts: "No bind artifacts",
  stack_incomplete: "Stack incomplete",
};

/** Operator-facing phrase for each WFB link-diagnosis verdict. */
export const DIAG_LABEL: Record<string, string> = {
  healthy: "Healthy",
  searching: "Searching",
  deaf: "Deaf (no RF seen)",
  mis_keyed: "Mis-keyed",
  jammed: "Jammed",
};

// Operator-facing phrase for each management-link repair rung the guardian
// reports. Keeps the on-screen copy plain; the agent ships the bland keys.
const MGMT_RUNG_PHRASE: Record<string, string> = {
  reassert_reg: "re-asserting regulatory domain",
  renew_dhcp: "renewing DHCP",
  reconnect_wifi: "reconnecting Wi-Fi",
  bounce_iface: "bouncing interface",
  restart_backend: "restarting network service",
  exhausted: "software repair exhausted, hardware-level recovery may be needed",
};

/**
 * Operating region and whether the link is pinned to its home channel. The
 * agent ships unrestricted (no region pinned); pinning a region restores the
 * strict regulatory gate. The explicit posture fields win, falling back to
 * the legacy `regDomain` for an agent that reports only that.
 */
export function regionReading(radio: RadioState | null): { value: string; unrestricted: boolean } {
  const pinnedRegion = radio?.pinnedRegion ?? radio?.regDomain ?? null;
  const unrestricted =
    radio?.regPosture === "unrestricted" || (radio?.regPosture == null && !pinnedRegion);
  const homeChannel = radio?.homeChannel ?? null;
  const channel = radio?.channel ?? null;
  const pinned = homeChannel != null && channel != null && homeChannel === channel;
  const value = unrestricted
    ? "Unrestricted"
    : pinned
      ? `${pinnedRegion} (pinned)`
      : (pinnedRegion ?? "Unrestricted");
  return { value, unrestricted };
}

/** Channel number, frequency and the channel acquirer's lock state. */
export function channelReading(radio: RadioState | null): {
  value: string;
  tone: "success" | "warning" | "muted";
} {
  const channel = radio?.channel ?? null;
  const freq = radio?.freqMhz ?? null;
  const acquire = radio?.acquireState ?? null;
  const label = channel != null ? `Ch ${channel}${freq != null ? ` (${freq} MHz)` : ""}` : "n/a";
  const locked = radio?.channelLocked === true || acquire === "locked";
  const searching = acquire === "searching";
  return {
    value: `${label} / ${locked ? "Lock OK" : searching ? "Searching" : "No lock"}`,
    tone: locked ? "success" : searching ? "warning" : "muted",
  };
}

/**
 * RF link: transmitting with no reception proven. The radio's own verdict is
 * authoritative when it reports one; the inference (transmitting while the
 * channel acquirer has not locked, reinforced by the newest transmit-proof
 * episode in the event feed) runs only when it does not. The pill names its
 * basis so an inference is never read as a measurement.
 */
export function rfLinkReading(
  radio: RadioState | null,
  recentEvents: readonly RadioNetworkActivity[],
): { value: string; tone: PillTone; title: string } {
  const txActive = radio?.txActive === true;
  const lastRfEvent = recentEvents.find((e) => e.kind === "radio.rf_unverified");
  const rf = resolveRfLink({
    reported: radio?.rfUnverified,
    txActive,
    acquireState: radio?.acquireState ?? null,
    channelLocked: radio?.channelLocked ?? null,
    eventUnverified: lastRfEvent != null && lastRfEvent.severity === "error",
  });
  const inferred = rf.source === "inferred";
  const suffix = inferred ? " (inferred)" : "";
  return {
    value: rf.unverified ? `Unverified${suffix}` : txActive ? `TX + reception${suffix}` : "Idle",
    tone: rf.unverified ? "error" : txActive ? "success" : "muted",
    title: inferred
      ? "This node reports no transmit-proof verdict. Inferred from the transmit flag, the channel lock, and recent link events."
      : "The radio's own verdict: it pairs the transmit counter with a confirmed return signal.",
  };
}

/** Radio stack state: "ok" is green, any other reported state warns. */
export function stackReading(state: AgentCapabilities["radioStackState"]): {
  value: string;
  tone: "success" | "warning";
} {
  return {
    value: state != null ? (STACK_LABEL[state] ?? state) : "n/a",
    tone: state === "ok" ? "success" : "warning",
  };
}

/**
 * Management link, the operator's path to the box. "degraded" means the link
 * is up but passes no traffic, rendered distinctly from healthy so a silent
 * dead path never reads as green. The note names the repair rung the guardian
 * is on.
 */
export function managementReading(link: AgentCapabilities["managementLink"]): OptionalPill {
  const state = link?.state;
  const value =
    state === "healthy"
      ? "Healthy"
      : state === "degraded"
        ? "Degraded (no data path)"
        : state === "down"
          ? "Down"
          : null;
  const tone = state === "healthy" ? "success" : state === "degraded" ? "warning" : "error";
  const note =
    link?.repairing && link.lastRung
      ? `Management link ${state}: ${MGMT_RUNG_PHRASE[link.lastRung] ?? "repairing"}${
          link.iface ? ` (${link.iface})` : ""
        }.`
      : null;
  return { value, tone, note };
}

/**
 * Reach-back: with the wired primary down the box falls back to a status-only
 * WiFi heartbeat (video and full telemetry do not flow over it). "primary" is
 * the normal state and shows no pill.
 */
export function reachbackReading(
  mode: AgentCapabilities["mgmtLinkMode"],
  failoverIface: AgentCapabilities["mgmtFailoverIface"],
): OptionalPill {
  if (mode === "wifi_heartbeat") {
    return {
      value: `WiFi heartbeat${failoverIface ? ` (${failoverIface})` : ""}`,
      tone: "warning",
      note: "Wired link down. Reachable over the onboard WiFi heartbeat only; video and full telemetry are unavailable until the wired link returns.",
    };
  }
  if (mode === "none") {
    return {
      value: "No reach-back",
      tone: "error",
      note: "Wired link down and no WiFi reach-back. The box may be unreachable until the wired link returns.",
    };
  }
  return { value: null, tone: "warning", note: null };
}

/**
 * USB rehome: the agent unbind/rebind-recovers a WFB adapter stuck on a slow
 * USB port. "idle" shows no pill; the other states warrant attention.
 */
export function rehomeReading(
  state: AgentCapabilities["usbRehomeState"],
  attempts: AgentCapabilities["usbRehomeAttempts"],
): OptionalPill {
  if (state === "rehoming") {
    const attempt = typeof attempts === "number" && attempts > 0 ? ` (attempt ${attempts})` : "";
    return { value: `Rehoming${attempt}`, tone: "warning", note: null };
  }
  if (state === "guard_blocked") {
    return {
      value: "Rehome held back",
      tone: "warning",
      note: "A rehome was held back because it could disturb the management link.",
    };
  }
  return { value: null, tone: "warning", note: null };
}
