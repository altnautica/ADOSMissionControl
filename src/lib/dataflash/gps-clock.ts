/**
 * Wall-clock anchor of an ArduPilot DataFlash log, from its GPS rows.
 *
 * `TimeUS` counts from boot; GPS rows pair it with the GPS week and
 * millisecond-of-week, which fixes the log onto UTC.
 *
 * @module dataflash/gps-clock
 * @license GPL-3.0-only
 */

import type { DataflashLog, DataflashRecord } from "./parser";

/** GPS time starts at 1980-01-06T00:00:00Z. */
const GPS_EPOCH_MS = Date.UTC(1980, 0, 6);
const GPS_WEEK_MS = 604_800_000;
/** GPS time runs ahead of UTC by the leap seconds added since 1980 (18 since 2017). */
const GPS_UTC_LEAP_SECONDS = 18;
/** ArduPilot GPS.Status of a 3D fix; below it the week/ms fields are not trusted. */
const GPS_FIX_3D = 3;

function field(r: DataflashRecord, key: string): number | undefined {
  const v = r[key];
  return typeof v === "number" ? v : undefined;
}

/**
 * Wall-clock time (UTC ms) of the log's `TimeUS = 0`, taken from the first GPS
 * row with a 3D fix and a week number. Undefined when the log has no GPS time.
 */
export function logClockOffsetMs(log: DataflashLog): number | undefined {
  for (const r of log.messages.get("GPS") ?? []) {
    const status = field(r, "Status");
    const week = field(r, "GWk");
    const msOfWeek = field(r, "GMS");
    const us = field(r, "TimeUS");
    if (status === undefined || status < GPS_FIX_3D) continue;
    if (!week || msOfWeek === undefined || us === undefined) continue;
    const utcMs = GPS_EPOCH_MS + week * GPS_WEEK_MS + msOfWeek - GPS_UTC_LEAP_SECONDS * 1000;
    return utcMs - us / 1000;
  }
  return undefined;
}
