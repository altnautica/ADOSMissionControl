/**
 * A flight with no telemetry recording was never measured or analysed, so its
 * summary says that instead of "0.0 km" and "No anomalies detected".
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { summarizeFlight } from "@/lib/ai/flight-summarizer";
import type { FlightRecord } from "@/lib/types";

const base = {
  id: "f1",
  droneId: "d1",
  droneName: "Alpha",
  date: Date.UTC(2026, 0, 15),
  duration: 720,
  distance: 0,
  maxAlt: 0,
  maxSpeed: 0,
  batteryUsed: 0,
  status: "completed",
  events: [],
  flags: [],
  updatedAt: 0,
} as unknown as FlightRecord;

describe("summarizeFlight", () => {
  it("says the flight was not analysed when no telemetry was recorded", () => {
    const text = summarizeFlight({ ...base, hasTelemetry: false });
    expect(text).toContain("No telemetry recorded; flight not analysed.");
    expect(text).not.toContain("No anomalies detected");
    expect(text).not.toContain("km");
  });

  it("reports distance and a clean result for an analysed flight", () => {
    const text = summarizeFlight({ ...base, hasTelemetry: true, distance: 2500 });
    expect(text).toContain("covering 2.5 km");
    expect(text).toContain("No anomalies detected.");
  });
});
