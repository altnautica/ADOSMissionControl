/**
 * @module hardware/radio/labels
 * @description Locale-aware label resolvers for the radio sub-panels.
 * Kept separate from the React components so they can be unit-tested
 * without spinning up the i18n provider.
 * @license GPL-3.0-only
 */

import type { useTranslations } from "next-intl";
import type {
  RadioLinkState,
  RadioTopology,
  RadioPeerLink,
  RadioHopState,
  RadioAcquireState,
  RadioLinkDiag,
} from "@/lib/api/ground-station/types";

export function linkStateLabel(
  t: ReturnType<typeof useTranslations>,
  state: RadioLinkState,
): string {
  const map: Record<RadioLinkState, string> = {
    absent: "linkState.absent",
    disconnected: "linkState.disconnected",
    unpaired: "linkState.unpaired",
    auto_pairing: "linkState.auto_pairing",
    binding: "linkState.binding",
    connecting: "linkState.connecting",
    connected: "linkState.connected",
    degraded: "linkState.degraded",
  };
  return t(map[state]);
}

export function topologyLabel(
  t: ReturnType<typeof useTranslations>,
  topology: RadioTopology,
): string {
  if (topology === "host_vbus") return t("topology.hostVbus");
  if (topology === "powered_hub") return t("topology.poweredHub");
  return t("topology.external5v");
}

export function peerLinkLabel(
  t: ReturnType<typeof useTranslations>,
  peerLink: RadioPeerLink,
): string {
  const map: Record<RadioPeerLink, string> = {
    linked: "peerLinkState.linked",
    searching: "peerLinkState.searching",
    no_peer: "peerLinkState.no_peer",
  };
  return t(map[peerLink]);
}

export function hopStateLabel(
  t: ReturnType<typeof useTranslations>,
  hopState: RadioHopState,
): string {
  const map: Record<RadioHopState, string> = {
    idle: "hopState.idle",
    searching: "hopState.searching",
    locked: "hopState.locked",
    hopping: "hopState.hopping",
  };
  return t(map[hopState]);
}

export function acquireStateLabel(
  t: ReturnType<typeof useTranslations>,
  acquireState: RadioAcquireState,
): string {
  const map: Record<RadioAcquireState, string> = {
    idle: "acquireState.idle",
    searching: "acquireState.searching",
    locked: "acquireState.locked",
    "no-peer": "acquireState.no_peer",
  };
  return t(map[acquireState]);
}

// Coarse radio-stack health rollup the agent reports on its heartbeat:
// "ok" or the reason the stack is not transmitting.
export type RadioStackState =
  | "ok"
  | "no_injection"
  | "unpaired"
  | "no_bind_artifacts"
  | "stack_incomplete";

export function radioStackStateLabel(
  t: ReturnType<typeof useTranslations>,
  state: RadioStackState,
): string {
  const map: Record<RadioStackState, string> = {
    ok: "radioStackState.ok",
    no_injection: "radioStackState.no_injection",
    unpaired: "radioStackState.unpaired",
    no_bind_artifacts: "radioStackState.no_bind_artifacts",
    stack_incomplete: "radioStackState.stack_incomplete",
  };
  return t(map[state]);
}

export function linkDiagLabel(
  t: ReturnType<typeof useTranslations>,
  diag: RadioLinkDiag,
): string {
  const map: Record<RadioLinkDiag, string> = {
    deaf: "linkDiag.deaf",
    mis_keyed: "linkDiag.mis_keyed",
    jammed: "linkDiag.jammed",
    healthy: "linkDiag.healthy",
    searching: "linkDiag.searching",
  };
  // The normalizer clamps unknown verdicts to null, but the cloud-relay radio
  // path is read un-normalized, so an out-of-contract string can reach here at
  // runtime. Render it verbatim rather than translating an undefined key.
  const key = map[diag];
  return key ? t(key) : String(diag);
}

// Semantic tone for the link-diagnosis verdict, matching the status color
// vocabulary: healthy is good, jammed warns, deaf / mis_keyed are errors,
// searching is a neutral in-progress state.
export type RadioDiagTone = "success" | "warning" | "error" | "muted";

export function linkDiagTone(diag: RadioLinkDiag): RadioDiagTone {
  switch (diag) {
    case "healthy":
      return "success";
    case "jammed":
      return "warning";
    case "deaf":
    case "mis_keyed":
      return "error";
    case "searching":
      return "muted";
    // An out-of-contract verdict over the un-normalized cloud-relay path reads
    // as a neutral/muted tone rather than falling through to undefined.
    default:
      return "muted";
  }
}

// Badge chip classes (border / bg / text) for the verdict, keyed to its
// semantic tone so the LinkHealthCard and DroneRadioPanel chips match.
export function linkDiagBadgeClass(diag: RadioLinkDiag): string {
  switch (linkDiagTone(diag)) {
    case "success":
      return "border-status-success/40 bg-status-success/10 text-status-success";
    case "warning":
      return "border-status-warning/40 bg-status-warning/10 text-status-warning";
    case "error":
      return "border-status-error/40 bg-status-error/10 text-status-error";
    case "muted":
      return "border-border-default bg-bg-tertiary text-text-tertiary";
  }
}

// Friendly band label. The agent emits the U-NII band slug; render a
// human label, falling back to the raw value for any future band.
export function bandLabel(
  t: ReturnType<typeof useTranslations>,
  band: string,
): string {
  if (band === "u-nii-1") return t("bandState.unii1");
  if (band === "u-nii-3") return t("bandState.unii3");
  if (band === "all") return t("bandState.all");
  return band;
}
