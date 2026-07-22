"use client";

/**
 * @module command/settings/SelfHealSection
 * @description The node Settings "Self-heal" page: the agent's always-on
 * connectivity + camera protections in one place. Two of them carry config
 * switches the agent's config surface exposes (the onboard-WiFi self-heal and
 * the camera USB recovery); the management-link guardian and the
 * regulatory-domain reconciler are always-on and tunable only in the node's
 * configuration file, so they render as live-status rows, never as toggles
 * that could not actually write.
 *
 * Live state (guardian link health, camera-recovery episode) comes from the
 * node's own status feed; "not reported" renders as exactly that. The recent
 * self-heal activity feed reads the node's durable on-device log store over
 * the LAN client — when no LAN client is attached (cloud session) or the
 * store is unreachable, the feed says so instead of showing an empty list as
 * if nothing happened.
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { HeartPulse, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import type { EventsRow } from "@/lib/agent/agent-client/logging";
import {
  SELF_HEAL_EVENT_KINDS,
  mapSelfHealEvents,
  repairRungPhrase,
  type SelfHealActivity,
} from "@/lib/agent/self-heal-events";
import type { RadioEventSeverity } from "@/lib/agent/radio-network-events";
import { formatLogTime } from "../shared/LogViewer";
import { ConfigToggleField } from "./ConfigFields";
import { Section } from "./Section";

/** How many activity rows to keep + render. */
const MAX_ACTIVITY = 15;
/** Over-fetch so the newest rows survive the multi-kind merge + cap. */
const QUERY_LIMIT = 60;
/** Look back over the last day so a freshly-opened page shows recent
 * boot-window heals without an unbounded scan. */
const LOOKBACK = "-24h";

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

interface SectionProps {
  config: Record<string, unknown> | null;
  readOnly: boolean;
  setValue: (key: string, value: string) => Promise<void>;
}

function StatusRow({
  label,
  value,
  valueClass,
  hint,
}: {
  label: string;
  value: string;
  valueClass?: string;
  hint?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs text-text-secondary">{label}</span>
        <span
          className={cn(
            "shrink-0 font-mono text-xs",
            valueClass ?? "text-text-primary",
          )}
        >
          {value}
        </span>
      </div>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

export function SelfHealSection({ config, readOnly, setValue }: SectionProps) {
  const t = useTranslations("nodeSettings.selfHeal");
  const managementLink = useAgentCapabilitiesStore((s) => s.managementLink);
  const cameraRecovery = useAgentCapabilitiesStore((s) => s.cameraUsbRecovery);
  const client = useAgentConnectionStore((s) => s.client);

  const [events, setEvents] = useState<SelfHealActivity[]>([]);
  /** True once the durable store answered at least once this session. */
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadEvents = useCallback(async () => {
    if (!client?.logging) {
      setAvailable(false);
      setEvents([]);
      return;
    }
    setLoading(true);
    try {
      const envelope = await client.logging.query<EventsRow>({
        kind: "events",
        event_kind: [...SELF_HEAL_EVENT_KINDS],
        from: LOOKBACK,
        limit: QUERY_LIMIT,
      });
      setEvents(mapSelfHealEvents(envelope.data, MAX_ACTIVITY));
      setAvailable(true);
    } catch {
      // The durable store is unreachable (cloud mode, network error, or a
      // pre-logd agent). The feed states that instead of an empty list.
      setAvailable(false);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  // ── Guardian live state (the node's own report; absent = "not reported") ──
  const guardianValue = (() => {
    switch (managementLink?.state) {
      case "healthy":
        return { text: t("guardianStateHealthy"), cls: "text-status-success" };
      case "degraded":
        return { text: t("guardianStateDegraded"), cls: "text-status-warning" };
      case "down":
        return { text: t("guardianStateDown"), cls: "text-status-error" };
      case "unknown":
        return { text: t("guardianStateUnknown"), cls: "text-text-tertiary" };
      default:
        return { text: t("notReported"), cls: "text-text-tertiary" };
    }
  })();
  const guardianRepairNote =
    managementLink?.repairing && managementLink.lastRung
      ? t("guardianRepairing", {
          phrase:
            repairRungPhrase(managementLink.lastRung) ?? managementLink.lastRung,
        })
      : null;

  // ── Camera-recovery live state ────────────────────────────────────────────
  const cameraValue = (() => {
    if (!cameraRecovery) return { text: t("notReported"), cls: "text-text-tertiary" };
    const attemptNote =
      cameraRecovery.attempts > 0
        ? ` (${cameraRecovery.attempts}/${cameraRecovery.maxAttempts})`
        : "";
    switch (cameraRecovery.state) {
      case "idle":
        return { text: t("cameraStateIdle"), cls: "text-text-secondary" };
      case "monitoring":
        return { text: t("cameraStateMonitoring"), cls: "text-status-success" };
      case "rebinding":
      case "port_cycling":
      case "hub_resetting":
        return {
          text: `${t("cameraStateRecovering")}${attemptNote}`,
          cls: "text-status-warning",
        };
      case "needs_hub_reset":
        return { text: t("cameraStateNeedsReseat"), cls: "text-status-warning" };
      case "guard_blocked":
        return { text: t("cameraStateHeldBack"), cls: "text-status-warning" };
      case "exhausted":
        return {
          text: `${t("cameraStateExhausted")}${attemptNote}`,
          cls: "text-status-error",
        };
      default:
        // Forward-versioned state: render the agent's own token raw.
        return { text: cameraRecovery.state, cls: "text-status-warning" };
    }
  })();

  return (
    <Section title={t("title")} icon={HeartPulse} blurb={t("blurb")}>
      {/* Config-backed switches — the two protections the agent's config
          surface exposes. */}
      <ConfigToggleField
        configKey="network.wifi_selfheal.enabled"
        label={t("wifiSelfHealLabel")}
        hint={t("wifiSelfHealHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />
      <ConfigToggleField
        configKey="video.usb_recovery.enabled"
        label={t("cameraRecoveryLabel")}
        hint={t("cameraRecoveryHint")}
        config={config}
        readOnly={readOnly}
        setValue={setValue}
      />

      {/* Always-on protections — live status, never a toggle the agent's
          config surface could not actually write. */}
      <div className="space-y-3 border-t border-border-default pt-3">
        <StatusRow
          label={t("guardianTitle")}
          value={guardianValue.text}
          valueClass={guardianValue.cls}
          hint={t("guardianHint")}
        />
        {guardianRepairNote ? (
          <p className="text-[11px] text-status-warning">{guardianRepairNote}</p>
        ) : null}
        <StatusRow
          label={t("cameraStateLabel")}
          value={cameraValue.text}
          valueClass={cameraValue.cls}
        />
        <StatusRow
          label={t("reconcilerTitle")}
          value={t("alwaysOn")}
          valueClass="text-text-secondary"
          hint={t("reconcilerHint")}
        />
      </div>

      {/* Recent self-heal activity from the node's durable log store. */}
      <div className="border-t border-border-default pt-3">
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="text-xs font-medium text-text-primary">
            {t("eventsTitle")}
          </span>
          <span className="font-mono text-[10px] text-text-tertiary">
            {t("eventsCount", { count: events.length })}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => void loadEvents()}
            className="flex cursor-pointer items-center gap-1 text-[10px] text-text-secondary hover:text-text-primary"
          >
            <RefreshCw
              size={11}
              className={loading ? "animate-spin" : undefined}
            />
            {t("refresh")}
          </button>
        </div>
        <div className="max-h-[200px] overflow-y-auto rounded border border-border-default/60">
          {events.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-text-tertiary">
              {available ? t("eventsEmpty") : t("eventsUnavailable")}
            </p>
          ) : (
            events.map((e) => (
              <div
                key={e.id}
                className="flex items-center gap-2 px-3 py-1 hover:bg-bg-tertiary/40"
              >
                <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                  {formatLogTime(e.ts)}
                </span>
                <span
                  className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
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
    </Section>
  );
}
