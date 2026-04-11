/**
 * Per-suite KPI calculators.
 *
 * Each function takes a FlightRecord and derives suite-specific metrics
 * from the available stats (distance, duration, path, alt, speed, etc.).
 * These are heuristic estimates — real suite KPIs require payload-specific
 * data (camera trigger count, spray volume, etc.) that will come in later
 * phases. For now we compute what's derivable from the FlightRecord alone.
 *
 * Phase 19 — mission KPIs.
 *
 * @module kpi/suite-kpis
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "../types";

export interface SuiteKpi {
  label: string;
  value: string;
  unit?: string;
}

/** Compute KPIs for a single flight based on its suite type. */
export function computeSuiteKpis(record: FlightRecord): SuiteKpi[] {
  switch (record.suiteType) {
    case "survey":
      return surveyKpis(record);
    case "agriculture":
      return agricultureKpis(record);
    case "cargo":
      return cargoKpis(record);
    case "sar":
      return sarKpis(record);
    case "inspection":
      return inspectionKpis(record);
    case "sentry":
      return sentryKpis(record);
    default:
      return [];
  }
}

function surveyKpis(r: FlightRecord): SuiteKpi[] {
  const areaCoveredHa = estimateAreaHa(r);
  const secondsPerHa = areaCoveredHa > 0 ? r.duration / areaCoveredHa : 0;
  return [
    { label: "Area covered", value: areaCoveredHa.toFixed(1), unit: "ha" },
    { label: "Efficiency", value: secondsPerHa > 0 ? secondsPerHa.toFixed(0) : "—", unit: "s/ha" },
    { label: "Track length", value: (r.distance / 1000).toFixed(2), unit: "km" },
    { label: "Avg GS", value: (r.avgSpeed ?? 0).toFixed(1), unit: "m/s" },
  ];
}

function agricultureKpis(r: FlightRecord): SuiteKpi[] {
  const areaCoveredHa = estimateAreaHa(r);
  return [
    { label: "Area treated", value: areaCoveredHa.toFixed(1), unit: "ha" },
    { label: "Track length", value: (r.distance / 1000).toFixed(2), unit: "km" },
    { label: "Flight time", value: fmtMin(r.duration) },
    { label: "Avg GS", value: (r.avgSpeed ?? 0).toFixed(1), unit: "m/s" },
  ];
}

function cargoKpis(r: FlightRecord): SuiteKpi[] {
  const distKm = r.distance / 1000;
  return [
    { label: "Route distance", value: distKm.toFixed(2), unit: "km" },
    { label: "Flight time", value: fmtMin(r.duration) },
    { label: "Avg speed", value: (r.avgSpeed ?? 0).toFixed(1), unit: "m/s" },
    { label: "Battery used", value: r.batteryUsed.toFixed(0), unit: "%" },
  ];
}

function sarKpis(r: FlightRecord): SuiteKpi[] {
  const searchAreaHa = estimateAreaHa(r);
  return [
    { label: "Search area", value: searchAreaHa.toFixed(1), unit: "ha" },
    { label: "Track length", value: (r.distance / 1000).toFixed(2), unit: "km" },
    { label: "Flight time", value: fmtMin(r.duration) },
    { label: "Max alt", value: r.maxAlt.toFixed(0), unit: "m" },
  ];
}

function inspectionKpis(r: FlightRecord): SuiteKpi[] {
  return [
    { label: "Track length", value: (r.distance / 1000).toFixed(2), unit: "km" },
    { label: "Flight time", value: fmtMin(r.duration) },
    { label: "Max alt", value: r.maxAlt.toFixed(0), unit: "m" },
    { label: "Avg speed", value: (r.avgSpeed ?? 0).toFixed(1), unit: "m/s" },
  ];
}

function sentryKpis(r: FlightRecord): SuiteKpi[] {
  const perimeterKm = r.distance / 1000;
  const dwellMin = r.duration / 60;
  return [
    { label: "Perimeter", value: perimeterKm.toFixed(2), unit: "km" },
    { label: "Dwell time", value: dwellMin.toFixed(1), unit: "min" },
    { label: "Max alt", value: r.maxAlt.toFixed(0), unit: "m" },
    { label: "Battery used", value: r.batteryUsed.toFixed(0), unit: "%" },
  ];
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Rough area estimate from the bounding box of the flight path.
 * Real area coverage needs camera trigger + GSD + overlap data.
 */
function estimateAreaHa(r: FlightRecord): number {
  if (!r.path || r.path.length < 3) return 0;
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const [lat, lon] of r.path) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
  }
  const latDist = (maxLat - minLat) * 111320; // meters
  const lonDist = (maxLon - minLon) * 111320 * Math.cos(((minLat + maxLat) / 2) * Math.PI / 180);
  const areaSqm = latDist * lonDist;
  return areaSqm / 10000; // hectares
}

function fmtMin(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

// ── Aggregate KPIs across multiple flights ───────────────────

export interface AggregateKpis {
  totalFlights: number;
  totalHours: number;
  totalDistanceKm: number;
  totalBatteryUsed: number;
  avgDurationMin: number;
  avgDistanceKm: number;
  avgMaxAlt: number;
  bySuite: { suite: string; count: number; hours: number }[];
  byDrone: { drone: string; count: number; hours: number }[];
}

export function computeAggregateKpis(records: FlightRecord[]): AggregateKpis {
  const totalFlights = records.length;
  const totalHours = records.reduce((s, r) => s + r.duration, 0) / 3600;
  const totalDistanceKm = records.reduce((s, r) => s + r.distance, 0) / 1000;
  const totalBatteryUsed = records.reduce((s, r) => s + r.batteryUsed, 0);
  const avgDurationMin = totalFlights > 0 ? records.reduce((s, r) => s + r.duration, 0) / totalFlights / 60 : 0;
  const avgDistanceKm = totalFlights > 0 ? totalDistanceKm / totalFlights : 0;
  const avgMaxAlt = totalFlights > 0 ? records.reduce((s, r) => s + r.maxAlt, 0) / totalFlights : 0;

  const suiteMap = new Map<string, { count: number; hours: number }>();
  const droneMap = new Map<string, { count: number; hours: number }>();

  for (const r of records) {
    const suite = r.suiteType ?? "none";
    const s = suiteMap.get(suite) ?? { count: 0, hours: 0 };
    s.count++;
    s.hours += r.duration / 3600;
    suiteMap.set(suite, s);

    const d = droneMap.get(r.droneName) ?? { count: 0, hours: 0 };
    d.count++;
    d.hours += r.duration / 3600;
    droneMap.set(r.droneName, d);
  }

  return {
    totalFlights,
    totalHours,
    totalDistanceKm,
    totalBatteryUsed,
    avgDurationMin,
    avgDistanceKm,
    avgMaxAlt,
    bySuite: Array.from(suiteMap.entries()).map(([suite, v]) => ({ suite, ...v })).sort((a, b) => b.hours - a.hours),
    byDrone: Array.from(droneMap.entries()).map(([drone, v]) => ({ drone, ...v })).sort((a, b) => b.hours - a.hours),
  };
}
