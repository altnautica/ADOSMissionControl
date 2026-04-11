"use client";

/**
 * Reports page — aggregate KPI dashboard with date-range filter.
 *
 * Shows total hours, distance, flights, battery usage + breakdowns by
 * suite and by drone. Uses the history store's records.
 *
 * Phase 19 — mission KPIs + reports.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { DataValue } from "@/components/ui/data-value";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useHistoryStore } from "@/stores/history-store";
import { useClockStore } from "@/stores/clock-store";
import { computeAggregateKpis } from "@/lib/kpi/suite-kpis";
import Link from "next/link";

type DatePreset = "all" | "7d" | "30d" | "90d" | "year";

export default function ReportsPage() {
  const records = useHistoryStore((s) => s.records);
  const loadFromIDB = useHistoryStore((s) => s.loadFromIDB);
  const clockNow = useClockStore((s) => s.now);
  const [preset, setPreset] = useState<DatePreset>("30d");

  useEffect(() => {
    void loadFromIDB();
  }, [loadFromIDB]);

  const filtered = useMemo(() => {
    if (preset === "all") return records;
    const days = preset === "7d" ? 7 : preset === "30d" ? 30 : preset === "90d" ? 90 : 365;
    const cutoff = clockNow - days * 86_400_000;
    return records.filter((r) => (r.startTime ?? r.date) >= cutoff);
  }, [records, preset, clockNow]);

  const kpis = useMemo(() => computeAggregateKpis(filtered), [filtered]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-bg-primary">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-default shrink-0">
        <div className="flex items-center gap-3">
          <Link href="/history">
            <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />}>
              History
            </Button>
          </Link>
          <h2 className="text-sm font-semibold text-text-primary uppercase tracking-wider">
            Reports
          </h2>
        </div>
        <div className="flex items-center gap-1">
          {(["7d", "30d", "90d", "year", "all"] as DatePreset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={`text-[10px] px-2 py-0.5 rounded ${
                preset === p
                  ? "bg-accent-primary/20 text-accent-primary"
                  : "text-text-secondary hover:text-text-primary"
              }`}
            >
              {p === "all" ? "All time" : p === "year" ? "1 year" : `Last ${p}`}
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
              <DataValue label="Total flights" value={kpis.totalFlights} />
            </Card>
            <Card padding={true}>
              <DataValue label="Total hours" value={kpis.totalHours.toFixed(1)} unit="h" />
            </Card>
            <Card padding={true}>
              <DataValue label="Total distance" value={kpis.totalDistanceKm.toFixed(1)} unit="km" />
            </Card>
            <Card padding={true}>
              <DataValue label="Total battery" value={kpis.totalBatteryUsed.toFixed(0)} unit="%" />
            </Card>
          </div>

          {/* Averages */}
          <Card title="Averages" padding={true}>
            <div className="grid grid-cols-3 gap-3">
              <DataValue label="Avg duration" value={kpis.avgDurationMin.toFixed(1)} unit="min" />
              <DataValue label="Avg distance" value={kpis.avgDistanceKm.toFixed(2)} unit="km" />
              <DataValue label="Avg max alt" value={kpis.avgMaxAlt.toFixed(0)} unit="m" />
            </div>
          </Card>

          {/* By suite */}
          {kpis.bySuite.length > 0 && (
            <Card title="By Suite" padding={true}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="text-left py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Suite</th>
                    <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Flights</th>
                    <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Hours</th>
                  </tr>
                </thead>
                <tbody>
                  {kpis.bySuite.map((s) => (
                    <tr key={s.suite} className="border-b border-border-default last:border-0">
                      <td className="py-1.5 px-2 text-text-primary capitalize">{s.suite}</td>
                      <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">{s.count}</td>
                      <td className="py-1.5 px-2 text-right text-text-primary font-mono tabular-nums">{s.hours.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* By drone */}
          {kpis.byDrone.length > 0 && (
            <Card title="By Drone" padding={true}>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-default">
                    <th className="text-left py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Drone</th>
                    <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Flights</th>
                    <th className="text-right py-1.5 px-2 text-[10px] uppercase text-text-secondary font-semibold">Hours</th>
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
                No flights in this period.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
