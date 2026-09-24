/**
 * @license GPL-3.0-only
 *
 * The log telemetry graph plots each stream at its own sample time and never
 * invents a zero for a reading that did not arrive.
 */

import { describe, it, expect } from "vitest";

import { buildLogGraphData } from "../LogTelemetryGraph";

const NOW = 100_000;

describe("buildLogGraphData", () => {
  it("places battery samples at their own time, not at the VFR sample index", () => {
    const vfr = [0, 1, 2, 3].map((i) => ({ timestamp: NOW - 4000 + i * 1000, alt: 10 + i, climb: 0 }));
    const battery = [{ timestamp: NOW - 1000, voltage: 16.2, remaining: 80 }];
    const points = buildLogGraphData(vfr, battery, [], NOW);
    const bat = points.filter((p) => p.battery !== undefined);
    expect(bat).toEqual([{ t: -1, battery: 16.2 }]);
  });

  it("leaves a gap instead of a zero when a stream has no samples", () => {
    const vfr = [{ timestamp: NOW - 2000, alt: 5, climb: 0 }, { timestamp: NOW - 1000, alt: 6, climb: 0 }];
    const points = buildLogGraphData(vfr, [], [{ timestamp: NOW - 500, channels: [], rssi: 255 }], NOW);
    expect(points.some((p) => p.battery === 0 || p.rssi === 0)).toBe(false);
    expect(points.some((p) => p.rssi !== undefined)).toBe(false);
  });
});
