"use client";

/**
 * Sticky aggregate stats bar above the History table.
 *
 * Recomputes from the currently filtered records on every render — cheap
 * for the typical few-thousand-record scale.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { FlightRecord } from "@/lib/types";
import { formatDecimal, formatKilometres } from "@/lib/i18n/format";

interface HistoryStatsBarProps {
  records: FlightRecord[];
}

export function HistoryStatsBar({ records }: HistoryStatsBarProps) {
  const t = useTranslations("history");
  const locale = useLocale();

  const stats = useMemo(() => {
    let totalSeconds = 0;
    let totalMeters = 0;
    let totalBattery = 0;
    for (const r of records) {
      totalSeconds += r.duration ?? 0;
      totalMeters += r.distance ?? 0;
      totalBattery += r.batteryUsed ?? 0;
    }
    return {
      count: records.length,
      hours: totalSeconds / 3600,
      km: totalMeters / 1000,
      battery: totalBattery,
    };
  }, [records]);

  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b border-border-default bg-bg-secondary/40 shrink-0 text-[11px] font-mono">
      <Stat label={t("statsFlights")} value={stats.count.toString()} />
      <Stat label={t("statsHours")} value={formatDecimal(stats.hours, 1, locale)} />
      <Stat label={t("statsDistance")} value={formatKilometres(stats.km, 1, locale)} />
      <Stat label={t("statsBattery")} value={`${stats.battery}%`} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-text-tertiary uppercase tracking-wider">{label}</span>
      <span className="text-text-primary tabular-nums font-semibold">{value}</span>
    </div>
  );
}
