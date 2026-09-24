/**
 * @license GPL-3.0-only
 *
 * Report averages are taken over the flights that report each metric; a
 * flight without an altitude or distance does not count as a zero.
 */

import { describe, it, expect } from "vitest";

import { computeAggregateKpis } from "../kpis";
import type { FlightRecord } from "@/lib/types";

function flight(extra: Partial<FlightRecord>): FlightRecord {
  const base: Pick<FlightRecord, "id" | "droneId" | "droneName" | "date" | "duration" | "status"> = {
    id: String(Math.random()),
    droneId: "d1",
    droneName: "Alpha",
    date: 0,
    duration: 600,
    status: "completed",
  };
  return { ...base, ...extra } as FlightRecord;
}

describe("computeAggregateKpis", () => {
  it("averages max altitude only over flights that report it", () => {
    const kpis = computeAggregateKpis([flight({ maxAlt: 100 }), flight({})]);
    expect(kpis.avgMaxAlt).toBe(100);
  });

  it("reports no average when no flight reports the metric", () => {
    const kpis = computeAggregateKpis([flight({}), flight({})]);
    expect(kpis.avgDistanceKm).toBeNull();
  });
});
