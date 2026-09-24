"use client";

/**
 * Reports page — aggregate KPI dashboard with date-range filter.
 *
 * Shows total hours, distance, flights, battery usage plus breakdown
 * by drone. Reads from the history store.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useHistoryStore } from "@/stores/history-store";
import { useClockStore } from "@/stores/clock-store";
import Link from "next/link";
import { computeAggregateKpis } from "./kpis";

type DatePreset = "all" | "7d" | "30d" | "90d" | "year";

export default function ReportsPage() {
  const t = useTranslations("history");
  const tr = useTranslations("history.reports");
  const records = useHistoryStore((s) => s.records);
  const clockNow = useClockStore((s) => s.now);
  const [preset, setPreset] = useState<DatePreset>("30d");

  const PRESET_LABELS = useMemo<Record<DatePreset, string>>(
    () => ({
      all: t("presetAll"),
      "7d": t("preset7d"),
      "30d": t("preset30d"),
      "90d": t("preset90d"),
      year: t("presetYear"),
    }),
    [t],
  );

  const filtered = useMemo(() => {
    // Trashed flights are out of every report until restored.
    const live = records.filter((r) => !r.deleted);
    if (preset === "all") return live;
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
    const cutoff = clockNow - days * 86_400_000;
    return live.filter((r) => (r.startTime ?? r.date) >= cutoff);
  }, [records, preset, clockNow]);

  const kpis = useMemo(() => computeAggregateKpis(filtered), [filtered]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/flight-logs">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
              {t("title")}
            </Button>
          </Link>
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            {t("reportsTitle")}
          </h2>
        </div>
        <div
          role="group"
          aria-label={t("datePresetLabel")}
          className="flex items-center gap-1"
        >
          {(["7d", "30d", "90d", "year", "all"] as DatePreset[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              aria-pressed={preset === p}
              className={`focus-ring text-[10px] px-2 py-0.5 rounded ${
                preset === p
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-4xl mx-auto flex flex-col gap-4">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card padding={true}>
              <DataValue label={tr("totalFlights")} value={kpis.totalFlights} />
            </Card>
            <Card padding={true}>
              <DataValue label={tr("totalHours")} value={kpis.totalHours.toFixed(1)} unit="h" />
            </Card>
            <Card padding={true}>
              <DataValue label={tr("totalDistance")} value={kpis.totalDistanceKm.toFixed(1)} unit="km" />
            </Card>
            <Card padding={true}>
              <DataValue label={tr("totalBattery")} value={kpis.totalBatteryUsed.toFixed(0)} unit="%" />
            </Card>
          </div>

          {/* Averages */}
          <Card title={tr("averages")} padding={true}>
            <div className="grid grid-cols-3 gap-3">
              <DataValue label={tr("avgDuration")} value={kpis.avgDurationMin === null ? "—" : kpis.avgDurationMin.toFixed(1)} unit="min" />
              <DataValue label={tr("avgDistance")} value={kpis.avgDistanceKm === null ? "—" : kpis.avgDistanceKm.toFixed(2)} unit="km" />
              <DataValue label={tr("avgMaxAlt")} value={kpis.avgMaxAlt === null ? "—" : kpis.avgMaxAlt.toFixed(0)} unit="m" />
            </div>
          </Card>

          {/* By drone */}
          {kpis.byDrone.length > 0 && (
            <Card title={tr("byDrone")} padding={true}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-default">
                    <th scope="col" className="text-left py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">{t("drone")}</th>
                    <th scope="col" className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">{t("statsFlights")}</th>
                    <th scope="col" className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">{t("statsHours")}</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.byDrone.map((d) => (
                    <tr key={d.drone} className="border-b border-border-default last:border-0">
                      <td className="py-1.5 px-2 text-text-primary">{d.drone}</td>
                      <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">{d.count}</td>
                      <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">{d.hours.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {filtered.length === 0 && (
            <Card padding={true}>
              <p className="text-[10px] text-text-tertiary text-center py-8">
                {t("reportsNoFlights")}
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
