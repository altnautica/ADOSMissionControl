/**
 * @module formats/csv-handler
 * @description CSV import/export for mission waypoints.
 * Columns: seq,lat,lon,alt,command,frame,speed,holdTime,param1,param2,param3,param4
 *
 * `param4` is only populated on a flattened ACTION row (a navigation waypoint's
 * fourth wire slot is `param3`), and exists so an action's fourth parameter
 * survives the round trip instead of being dropped.
 * @license GPL-3.0-only
 */

import type { AltitudeFrame, Waypoint, WaypointCommand } from "@/lib/types";
import { cmdMap } from "@/lib/mission-io-formats";
import {
  flattenForSerialization,
  foldLegacyWaypoints,
  type FlatWaypointRow,
} from "@/lib/mission/mission-expand";

const CSV_HEADER =
  "seq,lat,lon,alt,command,frame,speed,holdTime,param1,param2,param3,param4";

/**
 * Every command in the WaypointCommand union, derived from the command map so
 * a newly added command can never be silently coerced to WAYPOINT on import.
 */
const VALID_COMMANDS: Set<string> = new Set(Object.keys(cmdMap));

/**
 * Export waypoints as a CSV string.
 */
export function exportCSV(waypoints: Waypoint[]): string {
  const lines: string[] = [CSV_HEADER];

  // Flatten attached actions into sibling rows so the CSV carries them too.
  const flat = flattenForSerialization(waypoints);
  for (let i = 0; i < flat.length; i++) {
    const wp = flat[i];
    const row = [
      i + 1,
      wp.lat,
      wp.lon,
      wp.alt,
      wp.command ?? "WAYPOINT",
      wp.frame ?? "",
      wp.speed ?? "",
      wp.holdTime ?? "",
      wp.param1 ?? "",
      wp.param2 ?? "",
      wp.param3 ?? "",
      wp.param4 ?? "",
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}

/**
 * Download waypoints as a .csv file.
 */
export function downloadCSV(waypoints: Waypoint[], name: string): void {
  const csv = exportCSV(waypoints);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name || "mission"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Parse a CSV string into waypoints.
 * Flexible: handles missing columns, extra whitespace, quoted fields.
 */
export function parseCSV(text: string): Waypoint[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  // Parse header to determine column indices (use parseCsvLine for quote-aware trimming)
  const header = parseCsvLine(lines[0].toLowerCase());
  const colIndex: Record<string, number> = {};
  for (let i = 0; i < header.length; i++) {
    colIndex[header[i]] = i;
  }

  // Require at least lat and lon columns
  const latIdx = colIndex["lat"] ?? colIndex["latitude"] ?? -1;
  const lonIdx = colIndex["lon"] ?? colIndex["lng"] ?? colIndex["longitude"] ?? -1;
  if (latIdx === -1 || lonIdx === -1) {
    throw new Error("CSV must have lat and lon columns");
  }

  const altIdx = colIndex["alt"] ?? colIndex["altitude"] ?? -1;
  const cmdIdx = colIndex["command"] ?? colIndex["cmd"] ?? -1;
  const frameIdx = colIndex["frame"] ?? -1;
  const speedIdx = colIndex["speed"] ?? -1;
  const holdIdx = colIndex["holdtime"] ?? colIndex["hold_time"] ?? colIndex["hold"] ?? -1;
  const p1Idx = colIndex["param1"] ?? colIndex["p1"] ?? -1;
  const p2Idx = colIndex["param2"] ?? colIndex["p2"] ?? -1;
  const p3Idx = colIndex["param3"] ?? colIndex["p3"] ?? -1;
  const p4Idx = colIndex["param4"] ?? colIndex["p4"] ?? -1;

  const rows: FlatWaypointRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line);

    const lat = parseFloat(cols[latIdx] ?? "");
    const lon = parseFloat(cols[lonIdx] ?? "");
    if (isNaN(lat) || isNaN(lon)) continue;

    const alt = altIdx >= 0 ? parseFloat(cols[altIdx] ?? "0") : 0;
    const cmdStr = cmdIdx >= 0 ? (cols[cmdIdx] ?? "").trim().toUpperCase() : "WAYPOINT";
    const command: WaypointCommand = VALID_COMMANDS.has(cmdStr)
      ? (cmdStr as WaypointCommand)
      : "WAYPOINT";

    const frameStr = frameIdx >= 0 ? (cols[frameIdx] ?? "").trim().toLowerCase() : "";
    const frame: AltitudeFrame | undefined =
      frameStr === "relative" || frameStr === "absolute" || frameStr === "terrain"
        ? frameStr
        : undefined;

    const speed = speedIdx >= 0 ? parseFloat(cols[speedIdx] ?? "") : NaN;
    const holdTime = holdIdx >= 0 ? parseFloat(cols[holdIdx] ?? "") : NaN;
    const param1 = p1Idx >= 0 ? parseFloat(cols[p1Idx] ?? "") : NaN;
    const param2 = p2Idx >= 0 ? parseFloat(cols[p2Idx] ?? "") : NaN;
    const param3 = p3Idx >= 0 ? parseFloat(cols[p3Idx] ?? "") : NaN;
    const param4 = p4Idx >= 0 ? parseFloat(cols[p4Idx] ?? "") : NaN;

    rows.push({
      id: Math.random().toString(36).substring(2, 10),
      lat,
      lon,
      alt: isNaN(alt) ? 0 : alt,
      command,
      frame,
      speed: isNaN(speed) ? undefined : speed,
      holdTime: isNaN(holdTime) ? undefined : holdTime,
      param1: isNaN(param1) ? undefined : param1,
      param2: isNaN(param2) ? undefined : param2,
      param3: isNaN(param3) ? undefined : param3,
      param4: isNaN(param4) ? undefined : param4,
    });
  }

  // Fold any action-command rows into the navigation waypoint they follow.
  return foldLegacyWaypoints(rows);
}

/**
 * Parse a single CSV line, handling quoted fields.
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());

  return result;
}
