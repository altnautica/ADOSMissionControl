/**
 * A flight that reported no usable battery percentage has an unknown battery
 * use, never 0 %. Remaining = -1 is the autopilot's "not measured".
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import { computeFlightStats } from "@/lib/flight-lifecycle/stats";
import { buildSeries } from "@/lib/flight-analysis/series-builder";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";

const battery = (offsetMs: number, remaining: number, voltage = 16): TelemetryFrame => ({
  offsetMs,
  channel: "battery",
  data: { voltage, remaining },
});

describe("battery used", () => {
  it("is unknown when the pack only reports -1 remaining", () => {
    const stats = computeFlightStats([battery(0, -1, 16.8), battery(60_000, -1, 15.2)]);
    expect(stats.batteryUsed).toBeUndefined();
  });

  it("is unknown when the flight has no battery frames", () => {
    expect(computeFlightStats([]).batteryUsed).toBeUndefined();
  });

  it("is the drop in remaining percent when measured", () => {
    expect(computeFlightStats([battery(0, 90), battery(60_000, 62)]).batteryUsed).toBe(28);
  });

  it("charts -1 remaining as a gap, not as an empty pack", () => {
    const series = buildSeries([battery(0, -1), battery(1000, 80)]);
    expect(series.battery.map((p) => p.pct)).toEqual([undefined, 80]);
  });
});
