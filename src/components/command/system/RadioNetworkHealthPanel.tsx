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
import { useNodeDirectAgent } from "@/components/command/settings/use-node-direct-agent";
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
import {
  DIAG_LABEL,
  channelReading,
  managementReading,
  reachbackReading,
  regionReading,
  rehomeReading,
  rfLinkReading,
  stackReading,
} from "./radio-health-reading";
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

export function RadioNetworkHealthPanel({ nodeDeviceId }: { nodeDeviceId: string | null }) {
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

  // The activity feed is read through this node's own connection, never the
  // focused one (which lags the render on a node switch), and shown only when
  // the store holds this node's feed.
  const client = useNodeDirectAgent(nodeDeviceId)?.client ?? null;
  const mine = useRadioNetworkHealthStore((s) => s.deviceId === nodeDeviceId);
  const storeEvents = useRadioNetworkHealthStore((s) => s.recentEvents);
  const recentEvents = mine ? storeEvents : [];
  const wifiReassocRecent = useRadioNetworkHealthStore(
    (s) => s.wifiReassocRecent,
  );
  const available = useRadioNetworkHealthStore((s) => s.available) && mine;
  const loading = useRadioNetworkHealthStore((s) => s.loading);
  const loadEvents = useRadioNetworkHealthStore((s) => s.loadEvents);
  const clear = useRadioNetworkHealthStore((s) => s.clear);

  // Load when this node's connection attaches (and again if it changes);
  // clear on unmount so a freshly-focused node never shows another's feed.
  useEffect(() => {
    void loadEvents(nodeDeviceId, client);
    return () => clear();
  }, [nodeDeviceId, client, loadEvents, clear]);

  // Omit the whole panel when the agent advertises no radio surface at all
  // (a compute node, or a drone with no air-side adapter). Nothing useful
  // to show; the radio-aware panels above already cover the rest.
  const hasRadioSurface =
    radio !== null ||
    radioStackState !== undefined ||
    managementLink !== undefined ||
    mgmtLinkMode !== undefined;
  if (!hasRadioSurface) return null;

  const region = regionReading(radio);
  const channel = channelReading(radio);
  const rfLink = rfLinkReading(radio, recentEvents);
  const txActive = radio?.txActive === true;
  const stack = stackReading(radioStackState);
  const mgmt = managementReading(managementLink);
  const reachback = reachbackReading(mgmtLinkMode, mgmtFailoverIface);
  const rehome = rehomeReading(usbRehomeState, usbRehomeAttempts);

  // PHY muted: the adapter is at the muted txpower floor, injecting frames
  // yet radiating nothing. The agent advances tx_bytes so the link reads
  // alive while no RF leaves the antenna. Surface it as its own loud pill.
  const phyMuted = radio?.phyMuted === true;

  // WFB link diagnosis plus the raw frames-seen / decrypt-error counters. All
  // null on agents that don't report them; each pill renders only when a real
  // value arrives (no fabricated verdict or zero counter).
  const linkDiag = radio?.linkDiag ?? null;
  const packetsAll = radio?.packetsAll ?? null;
  const decryptErrors = radio?.decryptErrors ?? null;

  // Adapter health. Both readings come from the node's own report, so an
  // absent one reads as unknown rather than green: a chipset name says a
  // device was identified, never that it can inject.
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

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-5">
      <div className="mb-3 flex items-center gap-2">
        <Radio size={16} className="text-accent-primary" />
        <h2 className="text-lg font-medium text-text-primary">
          Radio / Network health
        </h2>
        <div className="flex-1" />
        <button
          onClick={() => void loadEvents(nodeDeviceId, client)}
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
          value={region.value}
          tone={region.unrestricted ? "warning" : "success"}
        />
        <Indicator label="Channel / lock" value={channel.value} tone={channel.tone} />
        <Indicator
          label="Onboard WiFi"
          value={!available ? "—" : wifiReassocRecent ? "Re-associating" : "Stable"}
          tone={!available ? "muted" : wifiReassocRecent ? "warning" : "success"}
        />
        <Indicator
          label="RF link"
          value={rfLink.value}
          tone={rfLink.tone}
          title={rfLink.title}
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
        <Indicator label="Radio stack" value={stack.value} tone={stack.tone} />
        {mgmt.value ? (
          <Indicator
            label="Management link"
            value={mgmt.value}
            tone={mgmt.tone}
          />
        ) : null}
        {reachback.value ? (
          <Indicator
            label="Reach-back"
            value={reachback.value}
            tone={reachback.tone}
          />
        ) : null}
        {rehome.value ? (
          <Indicator label="USB rehome" value={rehome.value} tone={rehome.tone} />
        ) : null}
      </div>

      {mgmt.note ? (
        <p className="mt-2 text-xs text-status-warning">{mgmt.note}</p>
      ) : null}
      {reachback.note ? (
        <p
          className={cn(
            "mt-2 text-xs",
            reachback.tone === "error" ? "text-status-error" : "text-status-warning",
          )}
        >
          {reachback.note}
        </p>
      ) : null}
      {rehome.note ? (
        <p
          className={cn(
            "mt-2 text-xs",
            rehome.tone === "error" ? "text-status-error" : "text-status-warning",
          )}
        >
          {rehome.note}
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
