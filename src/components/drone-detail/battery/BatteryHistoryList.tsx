"use client";

/**
 * @module drone-detail/battery/BatteryHistoryList
 * @description The Battery page's recent raise/clear transitions across every
 * pack, newest first. The agent keeps each pack's history bounded; this list
 * merges them and shows the newest rows.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { BatteryPack } from "@/lib/agent/schemas/battery";
import { cn } from "@/lib/utils";
import { formatLogTime } from "@/components/command/shared/LogViewer";
import { formatRuleValue, ruleLabel } from "./battery-format";

/** Rows rendered; enough to see a flight's worth of transitions. */
const MAX_ROWS = 20;

export function BatteryHistoryList({ packs }: { packs: BatteryPack[] }) {
  const t = useTranslations("batteryHealth");
  const rows = packs
    .flatMap((pack) => pack.history.map((event) => ({ pack: pack.id, event })))
    .sort((a, b) => b.event.at_ms - a.event.at_ms)
    .slice(0, MAX_ROWS);

  return (
    <section className="rounded border border-border-default bg-bg-secondary p-4">
      <h3 className="mb-2 text-sm font-semibold text-text-primary">{t("historyTitle")}</h3>
      {rows.length === 0 ? (
        <p className="text-[11px] text-text-tertiary">{t("historyEmpty")}</p>
      ) : (
        <ul className="max-h-[220px] space-y-0.5 overflow-y-auto">
          {rows.map(({ pack, event }) => {
            const raised = event.state === "raised";
            const tone = !raised
              ? "text-text-secondary"
              : event.severity === "critical"
                ? "text-status-error"
                : "text-status-warning";
            return (
              <li
                key={`${pack}:${event.rule}:${event.state}:${event.at_ms}`}
                className="flex items-center gap-2 text-xs"
              >
                <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                  {formatLogTime(event.at_ms)}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-text-tertiary">
                  {t("packTitle", { id: pack })}
                </span>
                <span className={cn("flex-1", tone)}>
                  {ruleLabel(t, event.rule)} · {raised ? t("raised") : t("cleared")}
                </span>
                <span className="font-mono text-[11px] text-text-secondary">
                  {formatRuleValue(event.rule, event.value)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
