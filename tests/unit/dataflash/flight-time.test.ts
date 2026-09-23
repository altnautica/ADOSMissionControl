/**
 * Imported dataflash flights carry the time they were flown, from the log's
 * GPS clock, and a log without one is marked as having no known date.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { DataflashLog, DataflashRecord } from "@/lib/dataflash/parser";
import { dataflashToFlightRecords } from "@/lib/dataflash/to-flight-record";

const S = 1_000_000; // µs per second

function dataflashLog(messages: Record<string, DataflashRecord[]>): DataflashLog {
  return {
    formats: new Map(),
    params: new Map(),
    messages: new Map(Object.entries(messages)),
    bytesRead: 0,
    resyncSkipped: 0,
  };
}

const ARM_DISARM = [
  { TimeUS: 10 * S, Id: 10 },
  { TimeUS: 70 * S, Id: 11 },
];

// GPS week 2300, 4 days into the week: 2024-02-01T00:00:00Z on the GPS clock.
const WEEK = 2300;
const MS_OF_WEEK = 4 * 86_400_000;
const GPS_UTC_MS = Date.UTC(1980, 0, 6) + WEEK * 604_800_000 + MS_OF_WEEK - 18_000;

describe("dataflash flight time", () => {
  it("dates the flight from the first 3D-fix GPS time", () => {
    const log = dataflashLog({
      EV: ARM_DISARM,
      GPS: [
        // No fix yet: its week/ms are not trusted.
        { TimeUS: 2 * S, Status: 1, GWk: 0, GMS: 0 },
        { TimeUS: 4 * S, Status: 3, GWk: WEEK, GMS: MS_OF_WEEK },
      ],
    });
    const [flight] = dataflashToFlightRecords(log);
    // Armed 6 s after the GPS row.
    expect(flight.record.startTime).toBe(GPS_UTC_MS + 6_000);
    expect(flight.record.date).toBe(GPS_UTC_MS + 6_000);
    expect(flight.record.endTime).toBe(GPS_UTC_MS + 66_000);
    expect(flight.record.startTimeUnknown).toBeUndefined();
  });

  it("marks the date unknown when the log has no GPS time", () => {
    const log = dataflashLog({ EV: ARM_DISARM, GPS: [{ TimeUS: 4 * S, Status: 1, GWk: 0, GMS: 0 }] });
    const [flight] = dataflashToFlightRecords(log);
    expect(flight.record.startTimeUnknown).toBe(true);
  });
});
