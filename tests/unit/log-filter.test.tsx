/**
 * Flight history filtering and sorting: the Sort dropdown and the column
 * headers drive one sort, a column header flips direction even under
 * StrictMode, and the custom date range is local calendar days with an
 * exclusive end.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useLogFilter } from "@/components/flight-logs/LogFilter";
import type { FlightRecord } from "@/lib/types";

function flight(id: string, startTime: number, distance = 0): FlightRecord {
  return {
    id,
    droneId: "d1",
    droneName: "Drone 1",
    date: startTime,
    startTime,
    endTime: startTime,
    duration: 0,
    distance,
    maxAlt: 0,
    maxSpeed: 0,
    waypointCount: 0,
    status: "completed",
    updatedAt: startTime,
  };
}

describe("history sort", () => {
  const records = [
    flight("old", new Date(2026, 0, 1).getTime(), 500),
    flight("new", new Date(2026, 5, 1).getTime(), 100),
  ];

  it("applies the dropdown choice and reflects it back", () => {
    const { result } = renderHook(() => useLogFilter(records));
    expect(result.current.filteredRecords.map((r) => r.id)).toEqual(["new", "old"]);
    act(() => result.current.handleSortSelect("date-asc"));
    expect(result.current.filteredRecords.map((r) => r.id)).toEqual(["old", "new"]);
    expect(result.current.sort).toBe("date-asc");
  });

  it("flips the active column's direction under StrictMode", () => {
    const { result } = renderHook(() => useLogFilter(records), { reactStrictMode: true });
    act(() => result.current.handleSortChange("distance"));
    expect(result.current.filteredRecords.map((r) => r.id)).toEqual(["old", "new"]);
    act(() => result.current.handleSortChange("distance"));
    expect(result.current.sortDir).toBe("asc");
    expect(result.current.filteredRecords.map((r) => r.id)).toEqual(["new", "old"]);
  });
});

describe("custom date range", () => {
  it("covers the local calendar days, excluding the next day's midnight", () => {
    const records = [
      flight("early-that-day", new Date(2026, 8, 23, 3, 0).getTime()),
      flight("next-midnight", new Date(2026, 8, 24, 0, 0).getTime()),
      flight("day-before", new Date(2026, 8, 22, 23, 30).getTime()),
    ];
    const { result } = renderHook(() => useLogFilter(records));
    act(() => {
      result.current.handleSetDateFrom("2026-09-23");
      result.current.handleSetDateTo("2026-09-23");
    });
    expect(result.current.filteredRecords.map((r) => r.id)).toEqual(["early-that-day"]);
  });
});
