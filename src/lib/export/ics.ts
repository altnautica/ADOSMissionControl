/**
 * ICS calendar export — generates an iCalendar file (RFC 5545) with one
 * VEVENT per flight record.
 *
 * Phase 24b.
 *
 * @module export/ics
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "../types";

/**
 * Build an RFC 5545 VCALENDAR string from an array of flight records.
 */
export function buildIcsCalendar(records: FlightRecord[]): string {
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Altnautica//ADOS Mission Control//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:ADOS Flight Log",
  ];

  for (const r of records) {
    const start = r.startTime ?? r.date;
    const end = r.endTime ?? start + r.duration * 1000;
    const title = r.customName ?? `${r.droneName} — ${formatDurationShort(r.duration)}`;
    const location = r.takeoffPlaceName ?? fmtCoords(r.takeoffLat, r.takeoffLon);

    const descParts: string[] = [
      `Drone: ${r.droneName}`,
      `Duration: ${formatDurationShort(r.duration)}`,
      `Distance: ${(r.distance / 1000).toFixed(2)} km`,
      `Max alt: ${r.maxAlt.toFixed(0)} m`,
      `Max speed: ${r.maxSpeed.toFixed(1)} m/s`,
      `Battery used: ${r.batteryUsed.toFixed(0)}%`,
      `Status: ${r.status}`,
    ];
    if (r.suiteType) descParts.push(`Suite: ${r.suiteType}`);
    if (r.notes) descParts.push(`Notes: ${r.notes.slice(0, 200)}`);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${r.id}@ados.altnautica.com`);
    lines.push(`DTSTART:${toIcsDate(start)}`);
    lines.push(`DTEND:${toIcsDate(end)}`);
    lines.push(`SUMMARY:${escapeIcs(title)}`);
    lines.push(`DESCRIPTION:${escapeIcs(descParts.join("\\n"))}`);
    if (location) lines.push(`LOCATION:${escapeIcs(location)}`);
    if (r.takeoffLat !== undefined && r.takeoffLon !== undefined) {
      lines.push(`GEO:${r.takeoffLat};${r.takeoffLon}`);
    }
    lines.push(`STATUS:${r.status === "completed" ? "CONFIRMED" : "TENTATIVE"}`);
    lines.push(`DTSTAMP:${toIcsDate(r.updatedAt ?? Date.now())}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/**
 * Export flights as a downloadable .ics file.
 */
export function exportFlightsAsIcs(records: FlightRecord[], filename?: string): void {
  const ics = buildIcsCalendar(records);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename ?? `ados-flights-${new Date().toISOString().slice(0, 10)}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Helpers ──────────────────────────────────────────────────

function toIcsDate(ms: number): string {
  const d = new Date(ms);
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function formatDurationShort(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s.toString().padStart(2, "0")}s`;
}

function fmtCoords(lat?: number, lon?: number): string {
  if (lat === undefined || lon === undefined) return "";
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
