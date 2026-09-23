/**
 * Telemetry exports report only what was measured: a CSV cell is empty before
 * a channel's first sample and once its last sample is stale, and the KML
 * places MSL altitude as absolute and labels it MSL.
 *
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ frames: [] as unknown[] }));
vi.mock("@/lib/telemetry-recorder", () => ({
  loadRecordingFrames: async () => h.frames,
}));

import { exportTelemetryAsCSV, exportTelemetryAsKML } from "@/lib/telemetry-export";
import type { TelemetryRecording } from "@/lib/telemetry-recorder";

const recording = {
  id: "r1",
  name: "Flight",
  startTime: 0,
  durationMs: 60_000,
  frameCount: 0,
} as unknown as TelemetryRecording;

const position = (offsetMs: number) => ({
  offsetMs,
  channel: "position",
  data: {
    lat: 12.9,
    lon: 77.6,
    alt: 650,
    relativeAlt: 50,
    heading: 90,
    groundSpeed: 5,
    climbRate: 0,
  },
});

function columns(csv: string, row: number): Record<string, string> {
  const [header, ...rows] = csv.split("\n");
  const names = header.split(",");
  const cells = rows[row].split(",");
  return Object.fromEntries(names.map((n, i) => [n, cells[i]]));
}

describe("exportTelemetryAsCSV", () => {
  it("leaves channels empty before their first sample and after they go stale", async () => {
    h.frames = [
      position(0),
      { offsetMs: 100, channel: "battery", data: { voltage: 16.4, remaining: 92 } },
      { offsetMs: 100, channel: "gps", data: { fixType: 3, satellites: 14, hdop: 0.8 } },
      { offsetMs: 100, channel: "attitude", data: { roll: 2, pitch: -1, yaw: 90 } },
      position(200),
      // No battery, GPS or attitude sample for well past the staleness window.
      position(20_000),
    ];
    const csv = await exportTelemetryAsCSV(recording);

    const before = columns(csv, 0);
    expect(before.battery_v).toBe("");
    expect(before.battery_pct).toBe("");
    expect(before.roll_deg).toBe("");
    expect(before.gps_fix).toBe("");

    const live = columns(csv, 1);
    expect(live.battery_v).toBe("16.4");
    expect(live.gps_fix).toBe("3");
    expect(live.roll_deg).toBe("2");

    const stale = columns(csv, 2);
    expect(stale.battery_pct).toBe("");
    expect(stale.gps_fix).toBe("");
    expect(stale.gps_satellites).toBe("");
    expect(stale.roll_deg).toBe("");
  });
});

describe("exportTelemetryAsKML", () => {
  it("places MSL altitude as absolute and labels the summary MSL", async () => {
    h.frames = [position(0), position(1000)];
    const kml = await exportTelemetryAsKML(recording);
    expect(kml).not.toContain("relativeToGround");
    expect(kml).toContain("<altitudeMode>absolute</altitudeMode>");
    expect(kml).toContain("Max Altitude: 650.0 m MSL");
    expect(kml).not.toContain("AGL");
  });
});
