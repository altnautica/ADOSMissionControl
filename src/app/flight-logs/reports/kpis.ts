/**
 * @module flight-logs/reports/kpis
 * @description Aggregate KPIs over a set of flight records. Totals sum what
 * each flight reports; averages are taken over the flights that report the
 * metric, and are null (shown as a dash) when none do.
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "@/lib/types";

export interface AggregateKpis {
  totalFlights: number;
  totalHours: number;
  totalDistanceKm: number;
  totalBatteryUsed: number;
  /** Averages over the flights that report the metric; null when none do. */
  avgDurationMin: number | null;
  avgDistanceKm: number | null;
  avgMaxAlt: number | null;
  byDrone: { drone: string; count: number; hours: number }[];
}

/** Mean of the values that are present, or null when none are. */
function meanOf(values: ReadonlyArray<number | undefined>): number | null {
  const present = values.filter((v): v is number => v !== undefined);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

export function computeAggregateKpis(records: readonly FlightRecord[]): AggregateKpis {
  const totalFlights = records.length;
  const totalSeconds = records.reduce((acc, r) => acc + (r.duration ?? 0), 0);
  const totalHours = totalSeconds / 3600;
  const totalDistanceKm =
    records.reduce((acc, r) => acc + (r.distance ?? 0), 0) / 1000;
  const totalBatteryUsed = records.reduce(
    (acc, r) => acc + (r.batteryUsed ?? 0),
    0,
  );
  const avgDurationSec = meanOf(records.map((r) => r.duration));
  const avgDistanceM = meanOf(records.map((r) => r.distance));
  const avgMaxAlt = meanOf(records.map((r) => r.maxAlt));
  const droneMap = new Map<string, { count: number; hours: number }>();
  for (const r of records) {
    const key = r.droneName || r.droneId || "(unknown)";
    const cur = droneMap.get(key) ?? { count: 0, hours: 0 };
    cur.count += 1;
    cur.hours += (r.duration ?? 0) / 3600;
    droneMap.set(key, cur);
  }
  const byDrone = Array.from(droneMap.entries())
    .map(([drone, v]) => ({ drone, ...v }))
    .sort((a, b) => b.hours - a.hours);
  return {
    totalFlights,
    totalHours,
    totalDistanceKm,
    totalBatteryUsed,
    avgDurationMin: avgDurationSec === null ? null : avgDurationSec / 60,
    avgDistanceKm: avgDistanceM === null ? null : avgDistanceM / 1000,
    avgMaxAlt,
    byDrone,
  };
}
