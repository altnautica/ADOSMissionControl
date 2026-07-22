"use client";

/**
 * @module command/system/RadioNetworkHealthPanel
 * @description Curated radio + onboard-network health surface for field RCA,
 * shown for any node with a radio — a drone or a ground station alike, since
 * both run the same radio stack and both can hit the same faults. Live
 * indicators (regulatory domain + pin, channel + lock, onboard-WiFi health,
 * RF-unverified flag, adapter USB + injection health, radio-stack
 * state) come from the heartbeat-backed agent-capabilities store; a compact
 * recent-activity feed of the radio/network events (reg re-asserts, bind
 * failures, RF-unverified entry/clear, WiFi self-heals) comes from the
 * durable on-device store via `client.logging`. Degrades gracefully: an
 * older agent or cloud mode shows the live indicators with an empty,
 * muted-note feed instead of crashing.
 * @license GPL-3.0-only
 */

import { useEffect } from "react";
import { Radio, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useRadioNetworkHealthStore } from "@/stores/radio-network-health-store";
import type { RadioEventSeverity } from "@/lib/agent/radio-network-events";
import {
  linkDiagTone,
  toneTextClass,
} from "@/components/hardware/radio/labels";
import {
  resolveAdapterInjection,
  resolveAdapterUsb,
  adapterInjectionLabel,
  adapterUsbLabel,
} from "@/components/hardware/radio/adapter-health";
import { resolveRfLink } from "./rf-link-reading";
import { formatLogTime } from "../shared/LogViewer";

const SEVERITY_DOT: Record<RadioEventSeverity, string> = {
  success: "bg-status-success",
  warning: "bg-status-warning",
  error: "bg-status-error",
};

const SEVERITY_TEXT: Record<RadioEventSeverity, string> = {
  success: "text-status-success",
  warning: "text-status-warning",
  error: "text-status-error",
};

const STACK_LABEL: Record<string, string> = {
  ok: "OK",
  no_injection: "No injection",
  unpaired: "Unpaired",
  no_bind_artifacts: "No bind artifacts",
  stack_incomplete: "Stack incomplete",
};

// Operator-facing phrase for each WFB link-diagnosis verdict.
const DIAG_LABEL: Record<string, string> = {
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

/** One live indicator pill: a label, a value, and a status color. */
function Indicator({
  label,
  value,
  tone,
  title,
}: {
  label: string;
  value: string;
  tone: "success" | "warning" | "error" | "muted";
  /** Optional hover text naming what the reading is based on. */
  title?: string;
}) {
  const valueClass = toneTextClass(tone);
  return (
    <div
      className="rounded border border-border-default/60 bg-bg-tertiary/40 px-3 py-2"
      title={title}
    >
      <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-sm", valueClass)}>{value}</div>
    </div>
  );
}

export function RadioNetworkHealthPanel() {
  const t = useTranslations("hardware.radio");
  const radio = useAgentCapabilitiesStore((s) => s.radio);
  const radioStackState = useAgentCapabilitiesStore((s) => s.radioStackState);
  const macStability = useAgentCapabilitiesStore((s) => s.macStability);
  const managementLink = useAgentCapabilitiesStore((s) => s.managementLink);
  const mgmtLinkMode = useAgentCapabilitiesStore((s) => s.mgmtLinkMode);
  const mgmtFailoverIface = useAgentCapabilitiesStore(
    (s) => s.mgmtFailoverIface,
  );
  const usbRehomeState = useAgentCapabilitiesStore((s) => s.usbRehomeState);
  const usbRehomeAttempts = useAgentCapabilitiesStore(
    (s) => s.usbRehomeAttempts,
  );

  const recentEvents = useRadioNetworkHealthStore((s) => s.recentEvents);
  const wifiReassocRecent = useRadioNetworkHealthStore(
    (s) => s.wifiReassocRecent,
  );
  const available = useRadioNetworkHealthStore((s) => s.available);
  const loading = useRadioNetworkHealthStore((s) => s.loading);
  const refresh = useRadioNetworkHealthStore((s) => s.refresh);
  const clear = useRadioNetworkHealthStore((s) => s.clear);

  // Load on mount; clear on unmount so a freshly-focused drone never shows
  // the previous one's activity feed.
  useEffect(() => {
    void refresh();
    return () => clear();
  }, [refresh, clear]);

  // Omit the whole panel when the agent advertises no radio surface at all
  // (a compute node, or a drone with no air-side adapter). Nothing useful
  // to show; the radio-aware panels above already cover the rest.
  const hasRadioSurface =
    radio !== null ||
    radioStackState !== undefined ||
    managementLink !== undefined ||
    mgmtLinkMode !== undefined;
  if (!hasRadioSurface) return null;

  // USB-rehome: the agent is unbind/rebind-recovering a WFB adapter stuck on a
  // slow USB port. "idle" shows no pill; the other states warrant attention.
  const rehomeValue =
    usbRehomeState === "rehoming"
      ? `Rehoming${
          typeof usbRehomeAttempts === "number" && usbRehomeAttempts > 0
            ? ` (attempt ${usbRehomeAttempts})`
            : ""
        }`
      : usbRehomeState === "exhausted"
        ? "Rehome exhausted"
        : usbRehomeState === "guard_blocked"
          ? "Rehome held back"
          : null;
  const rehomeTone: "warning" | "error" =
    usbRehomeState === "exhausted" ? "error" : "warning";
  const rehomeNote =
    usbRehomeState === "exhausted"
      ? "The adapter is on a slow USB port and a rehome could not recover it. Move it to a high-speed (480 Mbps) USB port."
      : usbRehomeState === "guard_blocked"
        ? "A rehome was held back because it could disturb the management link."
        : null;

  // ── Live indicators ──────────────────────────────────────────────────

  // Operating region + whether the link is pinned to its home channel.
  // The agent ships UNRESTRICTED out of the box (no region pinned); pinning
  // a region restores the strict regulatory gate. Prefer the explicit
  // posture fields, falling back to the legacy regDomain so an older agent
  // (regDomain only) still renders the right state.
  const regDomain = radio?.regDomain ?? null;
  const pinnedRegion = radio?.pinnedRegion ?? regDomain;
  const regUnrestricted =
    radio?.regPosture === "unrestricted" ||
    (radio?.regPosture == null && !pinnedRegion);
  const homeChannel = radio?.homeChannel ?? null;
  const channel = radio?.channel ?? null;
  const pinned =
    homeChannel != null && channel != null && homeChannel === channel;
  const regValue = regUnrestricted
    ? "Unrestricted"
    : pinned
      ? `${pinnedRegion} (pinned)`
      : (pinnedRegion ?? "Unrestricted");

  // Channel + lock state.
  const freq = radio?.freqMhz ?? null;
  const acquire = radio?.acquireState ?? null;
  const channelLocked = radio?.channelLocked ?? null;
  const channelLabel =
    channel != null
      ? `Ch ${channel}${freq != null ? ` (${freq} MHz)` : ""}`
      : "n/a";
  const locked = channelLocked === true || acquire === "locked";
  const searching = acquire === "searching";
  const channelValue = `${channelLabel} / ${
    locked ? "Lock OK" : searching ? "Searching" : "No lock"
  }`;
  const channelTone: "success" | "warning" | "muted" = locked
    ? "success"
    : searching
      ? "warning"
      : "muted";

  // RF link: transmitting with no reception proven. The radio's own verdict
  // is authoritative when it reports one; the older inference (transmitting
  // while the channel acquirer has not locked) runs only when it does not.
  // The event feed stays the episode history that reinforces the inference.
  const txActive = radio?.txActive === true;
  const lastRfEvent = recentEvents.find((e) => e.kind === "radio.rf_unverified");
  const rfLink = resolveRfLink({
    reported: radio?.rfUnverified,
    txActive,
    acquireState: acquire,
    channelLocked,
    eventUnverified:
      lastRfEvent != null && lastRfEvent.severity === "error",
  });
  const rfUnverified = rfLink.unverified;
  const rfInferred = rfLink.source === "inferred";
  // Name the basis on the pill so an inference is never read as a measurement.
  const rfLinkValue = rfUnverified
    ? rfInferred
      ? "Unverified (inferred)"
      : "Unverified"
    : txActive
      ? rfInferred
        ? "TX + reception (inferred)"
        : "TX + reception"
      : "Idle";
  const rfLinkTitle = rfInferred
    ? "This node reports no transmit-proof verdict. Inferred from the transmit flag, the channel lock, and recent link events."
    : "The radio's own verdict: it pairs the transmit counter with a confirmed return signal.";

  // PHY muted: the adapter is at the muted txpower floor, injecting frames
  // yet radiating nothing. The agent advances tx_bytes so the link reads
  // alive while no RF leaves the antenna. Surface it as its own loud pill.
  const phyMuted = radio?.phyMuted === true;

  // WFB link diagnosis: the received-side verdict on why the link is (or
  // is not) carrying payload, plus the raw frames-seen / decrypt-error
  // counters. All null on older agents that don't report them — each
  // pill only renders when a real value arrives (no fabricated verdict or
  // zero counter).
  const linkDiag = radio?.linkDiag ?? null;
  const packetsAll = radio?.packetsAll ?? null;
  const decryptErrors = radio?.decryptErrors ?? null;

  // Onboard-WiFi self-heal recency is derived in the store (it reads the
  // freshness clock there, keeping this render body pure).

  // Adapter health. Both readings come from the node's own report, so an
  // absent one reads as unknown rather than green: a chipset name says a
  // device was identified, never that it can inject, and nodes have reported
  // a hardcoded injection-ok before, so inferring health from either would
  // paint a dead radio as working.
  const injection = resolveAdapterInjection({
    injectionOk: radio?.adapterInjectionOk,
    chipset: radio?.adapterChipset,
  });
  const pinnedAdapter = macStability?.adapters?.find(
    (a) => a.state === "pinned",
  );
  const adapterValue = pinnedAdapter
    ? `${adapterInjectionLabel(t, injection)} · ${t("adapterMacPinned")}`
    : adapterInjectionLabel(t, injection);

  // USB link of the selected adapter. An adapter that enumerated below high
  // speed advances its transmit counter while emitting almost no RF, so this
  // is the reading that explains an otherwise healthy-looking dead link.
  const usb = resolveAdapterUsb({
    degraded: radio?.adapterUsbDegraded,
    speedMbps: radio?.adapterUsbSpeedMbps,
  });

  const stackValue =
    radioStackState != null
      ? (STACK_LABEL[radioStackState] ?? radioStackState)
      : "n/a";
  const stackTone: "success" | "warning" =
    radioStackState === "ok" ? "success" : "warning";

  // Management link: the operator's path to the box. "degraded" means the link
  // is up but passes no traffic (gateway unreachable) — rendered distinctly
  // from healthy so a silent dead path never reads as green. Repair progress
  // shows the rung the guardian is on.
  const mgmtState = managementLink?.state;
  const mgmtValue =
    mgmtState === "healthy"
      ? "Healthy"
      : mgmtState === "degraded"
        ? "Degraded (no data path)"
        : mgmtState === "down"
          ? "Down"
          : null;
  const mgmtTone: "success" | "warning" | "error" =
    mgmtState === "healthy"
      ? "success"
      : mgmtState === "degraded"
        ? "warning"
        : "error";
  const mgmtRepairNote =
    managementLink?.repairing && managementLink.lastRung
      ? `Management link ${mgmtState}: ${
          MGMT_RUNG_PHRASE[managementLink.lastRung] ?? "repairing"
        }${managementLink.iface ? ` (${managementLink.iface})` : ""}.`
      : null;

  // Reach-back: when the wired primary is down the box falls back to a
  // status-only WiFi heartbeat. Surface it as a degraded posture (video + full
  // telemetry do not flow over it), distinct from a healthy link. "primary" is
  // the normal state and shows no pill.
  const reachbackValue =
    mgmtLinkMode === "wifi_heartbeat"
      ? `WiFi heartbeat${mgmtFailoverIface ? ` (${mgmtFailoverIface})` : ""}`
      : mgmtLinkMode === "none"
        ? "No reach-back"
        : null;
  const reachbackTone: "warning" | "error" =
    mgmtLinkMode === "none" ? "error" : "warning";
  const reachbackNote =
    mgmtLinkMode === "wifi_heartbeat"
      ? "Wired link down. Reachable over the onboard WiFi heartbeat only; video and full telemetry are unavailable until the wired link returns."
      : mgmtLinkMode === "none"
        ? "Wired link down and no WiFi reach-back. The box may be unreachable until the wired link returns."
        : null;

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        <Radio size={16} className="text-accent-primary" />
        <h2 className="text-lg font-medium text-text-primary">
          Radio / Network health
        </h2>
        <div className="flex-1" />
        <button
          onClick={() => void refresh()}
          className="flex items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary cursor-pointer"
        >
          <RefreshCw size={11} className={loading ? "animate-spin" : undefined} />
          Refresh
        </button>
      </div>

      {/* Live indicators */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Indicator
          label="Operating region"
          value={regValue}
          tone={regUnrestricted ? "warning" : "success"}
        />
        <Indicator label="Channel / lock" value={channelValue} tone={channelTone} />
        <Indicator
          label="Onboard WiFi"
          value={wifiReassocRecent ? "Re-associating" : "Stable"}
          tone={wifiReassocRecent ? "warning" : "success"}
        />
        <Indicator
          label="RF link"
          value={rfLinkValue}
          tone={rfUnverified ? "error" : txActive ? "success" : "muted"}
          title={rfLinkTitle}
        />
        {linkDiag != null ? (
          <Indicator
            label="Link diagnosis"
            value={DIAG_LABEL[linkDiag] ?? linkDiag}
            tone={linkDiagTone(linkDiag)}
          />
        ) : null}
        {packetsAll != null ? (
          <Indicator
            label="Packets seen"
            value={String(packetsAll)}
            tone="muted"
          />
        ) : null}
        {decryptErrors != null ? (
          <Indicator
            label="Decrypt errors"
            value={String(decryptErrors)}
            tone={decryptErrors > 0 ? "warning" : "muted"}
          />
        ) : null}
        <Indicator
          label="PHY status"
          value={
            phyMuted ? "Muted (no RF)" : txActive ? "Transmitting" : "Idle"
          }
          tone={phyMuted ? "error" : txActive ? "success" : "muted"}
        />
        <Indicator
          label={t("adapterInjection.label")}
          value={adapterValue}
          tone={injection.tone}
        />
        <Indicator
          label={t("adapterUsb.label")}
          value={adapterUsbLabel(t, usb)}
          tone={usb.tone}
          title={
            usb.state === "degraded" ? t("adapterUsbDegradedHint") : undefined
          }
        />
        <Indicator label="Radio stack" value={stackValue} tone={stackTone} />
        {mgmtValue ? (
          <Indicator
            label="Management link"
            value={mgmtValue}
            tone={mgmtTone}
          />
        ) : null}
        {reachbackValue ? (
          <Indicator
            label="Reach-back"
            value={reachbackValue}
            tone={reachbackTone}
          />
        ) : null}
        {rehomeValue ? (
          <Indicator label="USB rehome" value={rehomeValue} tone={rehomeTone} />
        ) : null}
      </div>

      {mgmtRepairNote ? (
        <p className="mt-2 text-xs text-status-warning">{mgmtRepairNote}</p>
      ) : null}
      {reachbackNote ? (
        <p
          className={cn(
            "mt-2 text-xs",
            mgmtLinkMode === "none"
              ? "text-status-error"
              : "text-status-warning",
          )}
        >
          {reachbackNote}
        </p>
      ) : null}
      {rehomeNote ? (
        <p
          className={cn(
            "mt-2 text-xs",
            usbRehomeState === "exhausted"
              ? "text-status-error"
              : "text-status-warning",
          )}
        >
          {rehomeNote}
        </p>
      ) : null}

      {/* Recent activity */}
      <div className="mt-4">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-xs font-medium text-text-primary">
            Recent activity
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">
            {recentEvents.length} {recentEvents.length === 1 ? "event" : "events"}
          </span>
        </div>
        <div className="max-h-[200px] overflow-y-auto rounded border border-border-default/60">
          {recentEvents.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">
              {available
                ? "No recent radio or network events."
                : "Activity history unavailable (agent may not support the durable log store)."}
            </p>
          ) : (
            recentEvents.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 px-3 py-1 hover:bg-bg-tertiary/40"
              >
                <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                  {formatLogTime(e.ts)}
                </span>
                <span
                  className={cn(
                    "shrink-0 h-1.5 w-1.5 rounded-full",
                    SEVERITY_DOT[e.severity],
                  )}
                />
                <span className={cn("flex-1 text-xs", SEVERITY_TEXT[e.severity])}>
                  {e.summary}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
