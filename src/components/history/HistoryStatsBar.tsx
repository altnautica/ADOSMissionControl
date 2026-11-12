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
import { computeAggregateKpis } from "@/app/flight-logs/reports/kpis";

interface HistoryStatsBarProps {
  records: FlightRecord[];
}

export function HistoryStatsBar({ records }: HistoryStatsBarProps) {
  const t = useTranslations("history");
  const locale = useLocale();

  // Same aggregates as Reports. Battery is the mean per flight: battery
  // percentages from different flights do not add up to anything.
  const kpis = useMemo(() => computeAggregateKpis(records), [records]);

  return (
    <div className="flex items-center gap-6 px-4 py-2 border-b border-border-default bg-bg-secondary/40 shrink-0 text-[11px] font-mono">
      <Stat label={t("statsFlights")} value={kpis.totalFlights.toString()} />
      <Stat label={t("statsHours")} value={formatDecimal(kpis.totalHours, 1, locale)} />
      <Stat label={t("statsDistance")} value={formatKilometres(kpis.totalDistanceKm, 1, locale)} />
      <Stat
        label={t("statsBatteryAvg")}
        value={kpis.avgBatteryUsed === null ? "—" : `${formatDecimal(kpis.avgBatteryUsed, 0, locale)}%`}
      />
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
