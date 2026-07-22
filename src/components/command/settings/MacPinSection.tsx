"use client";

/**
 * @module command/settings/MacPinSection
 * @description The node Settings "MAC pinning" page. An adapter without a
 * hardware (efuse) MAC randomizes its address each boot, which churns the
 * node's DHCP lease and IP; the agent pins a stable MAC so the address stops
 * moving. This page surfaces the per-adapter verdicts the node itself reports
 * on its status feed (pinned / candidate / deferred / disabled) and binds the
 * two config switches — automatic pinning and the opt-in live re-tag — through
 * the shared config writer.
 *
 * Honesty posture: the adapter list is the node's own report. A node that has
 * not reported adapter stability (older agent, no status yet) reads "not
 * reported"; a node that reports an empty list reads "no adapters need
 * pinning" — the two are different facts and render differently. Pin / unpin
 * of individual adapters stays on the node (`ados network mac` CLI); this page
 * only surfaces the state and the enable switches.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Fingerprint } from "lucide-react";

import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import type { MacStabilityAdapter } from "@/lib/agent/feature-types";
import { ConfigToggleField } from "./ConfigFields";
import { Section } from "./Section";

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

const STATE_CLASS: Record<string, string> = {
  stable: "text-text-secondary",
  pinned: "text-status-success",
  candidate: "text-status-warning",
  deferred: "text-status-warning",
  disabled: "text-text-secondary",
};

function StatRow({ label, value, valueClass }: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[11px] text-text-tertiary">{label}</span>
      <span
        className={`shrink-0 font-mono text-xs ${valueClass ?? "text-text-primary"}`}
      >
        {value}
      </span>
    </div>
  );
}

function AdapterCard({ adapter }: { adapter: MacStabilityAdapter }) {
  const t = useTranslations("nodeSettings.macPin");
  const state = adapter.state ?? "stable";

  // Known states map to translated labels; a forward-versioned state string
  // renders raw rather than being mislabeled.
  const stateLabel = (() => {
    switch (state) {
      case "stable":
        return t("stateStable");
      case "pinned":
        return t("statePinned");
      case "candidate":
        return t("stateCandidate");
      case "deferred":
        return t("stateDeferred");
      case "disabled":
        return t("stateDisabled");
      default:
        return state;
    }
  })();

  const sourceLabel = (() => {
    switch (adapter.source) {
      case "quirk":
        return t("sourceQuirk");
      case "learned":
        return t("sourceLearned");
      case "override":
        return t("sourceOverride");
      default:
        return adapter.source ?? null;
    }
  })();

  const title = adapter.name || adapter.vidpid || t("adapterFallbackName");

  return (
    <div className="rounded border border-border-default/60 p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="font-mono text-sm text-text-primary">{title}</span>
        <span
          className={`shrink-0 text-xs font-medium ${
            STATE_CLASS[state] ?? "text-text-secondary"
          }`}
        >
          {stateLabel}
        </span>
      </div>
      <div className="space-y-1">
        {adapter.vidpid ? (
          <StatRow label={t("chipsetLabel")} value={adapter.vidpid} />
        ) : null}
        {adapter.pinnedMac ? (
          <StatRow
            label={t("pinnedMacLabel")}
            value={adapter.pinnedMac}
            valueClass="text-status-success"
          />
        ) : null}
        {adapter.lastSeenMac && adapter.lastSeenMac !== adapter.pinnedMac ? (
          <StatRow label={t("currentMacLabel")} value={adapter.lastSeenMac} />
        ) : null}
        {sourceLabel ? (
          <StatRow label={t("sourceLabel")} value={sourceLabel} />
        ) : null}
      </div>
      {state === "candidate" ? (
        <p className="mt-2 text-[11px] text-status-warning">
          {t("candidateHint")}{" "}
          <code className="font-mono">
            ados network mac pin {adapter.name ?? "<iface>"}
          </code>
        </p>
      ) : null}
      {adapter.deferredReason ? (
        <p className="mt-2 text-[11px] text-status-warning">
          {t("deferredReason", { reason: adapter.deferredReason })}
        </p>
      ) : null}
    </div>
  );
}

export function MacPinSection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.macPin");
  // The per-adapter verdicts ride the node's status feed (LAN full-status or
  // the cloud heartbeat), so the list works over either transport.
  const macStability = useAgentCapabilitiesStore((s) => s.macStability);

  const adapters = macStability?.adapters;

  return (
    <Section title={t("title")} icon={Fingerprint} blurb={t("blurb")}>
      {/* Config switches — the automatic pin service + the opt-in live re-tag. */}
      <ConfigToggleField
        configKey="network.mac_pin.enabled"
        label={t("enabledLabel")}
        hint={t("enabledHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <ConfigToggleField
        configKey="network.mac_pin.apply_live_allowed"
        label={t("applyLiveLabel")}
        hint={t("applyLiveHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Tracked adapters — the node's own report. "Not reported" (no status
          from this node yet / older agent) and "none tracked" (the node says
          nothing needs pinning) are different facts. */}
      <div className="space-y-2 border-t border-border-default pt-3">
        <div className="text-xs text-text-secondary">{t("adaptersTitle")}</div>
        {adapters === undefined ? (
          <p className="text-[11px] text-text-tertiary">{t("notReported")}</p>
        ) : adapters.length === 0 ? (
          <p className="text-[11px] text-text-tertiary">{t("noneTracked")}</p>
        ) : (
          <>
            {adapters.map((a, idx) => (
              <AdapterCard
                key={a.usbPath || a.name || a.vidpid || String(idx)}
                adapter={a}
              />
            ))}
            {adapters.some((a) => a.pinnedMac) ? (
              <p className="text-[11px] text-text-tertiary">{t("dhcpHint")}</p>
            ) : null}
          </>
        )}
      </div>
    </Section>
  );
}
