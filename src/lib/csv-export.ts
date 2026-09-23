/**
 * CSV export utility for flight history records.
 * @license GPL-3.0-only
 */

import type { FlightRecord } from "@/lib/types";
import { formatDate, formatTime, formatDuration } from "@/lib/utils";
import { downloadBlob } from "@/lib/download";

/**
 * Export an array of flight records as a CSV file download.
 *
 * Columns: Date, Time, Drone, Duration, Distance (km), Max Alt (m),
 *          Max Speed (m/s), Status, Battery Used (%), Suite, Waypoints
 */
export function exportFlightRecordsAsCsv(records: FlightRecord[]): void {
  const header = [
    "Date",
    "Time",
    "Drone",
    "Duration",
    "Distance (km)",
    "Max Alt (m)",
    "Max Speed (m/s)",
    "Status",
    "Battery Used (%)",
    "Waypoints",
  ];

  const rows = records.map((r) => [
    formatDate(r.date),
    formatTime(r.date),
    r.droneName,
    formatDuration(r.duration),
    r.distance !== undefined ? (r.distance / 1000).toFixed(2) : "",
    r.maxAlt !== undefined ? String(r.maxAlt) : "",
    r.maxSpeed !== undefined ? String(r.maxSpeed) : "",
    r.status,
    r.batteryUsed !== undefined ? String(r.batteryUsed) : "",
    String(r.waypointCount),
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row.map((cell) => {
        // Escape cells containing commas or quotes
        if (cell.includes(",") || cell.includes('"') || cell.includes("\n")) {
          return `"${cell.replace(/"/g, '""')}"`;
        }
        return cell;
      }).join(","),
    )
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const now = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  downloadBlob(blob, `flight-history-${dateStr}.csv`);
}
