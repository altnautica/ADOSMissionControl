/**
 * Events and estimates History derives from a recorded flight, and the
 * measured basis each one needs:
 * - takeoff and land come from leaving and regaining the ground, so a bench
 *   arm/disarm records neither;
 * - a SYS_STATUS remaining % is a reading, never an autopilot failsafe;
 * - one sustained vibration spike is one event;
 * - wind is the autopilot's estimate, or ground track minus a real airspeed.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import { analyzeFlight } from "@/lib/flight-analysis/analyzer";
import { estimateWind } from "@/lib/flight-analysis/wind-estimator";

function pos(offsetMs: number, relativeAlt: number, lat = 12.97, lon = 77.59): TelemetryFrame {
  return { offsetMs, channel: "position", data: { lat, lon, relativeAlt } };
}

describe("takeoff and land events", () => {
  it("records neither for an arm/disarm that never leaves the ground", () => {
    const frames = [pos(0, 0), pos(1000, 0.3), pos(2000, 0.1), pos(3000, 0)];
    const types = analyzeFlight(frames).events.map((e) => e.type);
    expect(types).not.toContain("takeoff");
    expect(types).not.toContain("land");
  });

  it("marks takeoff when the vehicle climbs off the ground and land when it is back", () => {
    const frames = [pos(0, 0), pos(1000, 1), pos(2000, 5), pos(3000, 10), pos(4000, 1), pos(5000, 0)];
    const events = analyzeFlight(frames).events;
    expect(events.find((e) => e.type === "takeoff")?.t).toBe(2000);
    expect(events.find((e) => e.type === "land")?.t).toBe(4000);
  });

  it("has no land event for a log that ends in the air", () => {
    const frames = [pos(0, 0), pos(1000, 5), pos(2000, 20)];
    expect(analyzeFlight(frames).events.map((e) => e.type)).not.toContain("land");
  });
});

describe("SYS_STATUS battery reading", () => {
  it("is reported as a low reading, not as a battery failsafe", () => {
    const frames: TelemetryFrame[] = [{ offsetMs: 0, channel: "sysStatus", data: { batteryRemaining: 12 } }];
    const events = analyzeFlight(frames).events;
    expect(events.map((e) => e.type)).not.toContain("failsafe_battery");
    expect(events).toEqual([expect.objectContaining({ type: "battery_below", severity: "warning" })]);
  });
});

describe("vibration spikes", () => {
  it("reports one sustained spike once, with its peak and end", () => {
    const frames: TelemetryFrame[] = [];
    for (let i = 0; i < 40; i++) {
      const rms = i === 20 ? 50 : 35;
      frames.push({ offsetMs: i * 250, channel: "vibration", data: { vibrationX: rms, vibrationY: rms, vibrationZ: rms } });
    }
    const spikes = analyzeFlight(frames).events.filter((e) => e.type === "vibration_spike");
    expect(spikes).toHaveLength(1);
    expect(spikes[0].t).toBe(0);
    expect(spikes[0].data).toMatchObject({ endT: 39 * 250 });
    expect(spikes[0].data?.rms).toBeCloseTo(50);
  });
});

describe("wind estimate", () => {
  const DEG = Math.PI / 180;

  /** A copter flying north at `gs` m/s, VFR_HUD airspeed equal to groundspeed. */
  function copterFrames(gs: number, withSensor: boolean): TelemetryFrame[] {
    const frames: TelemetryFrame[] = [];
    for (let i = 0; i < 20; i++) {
      const t = i * 1000;
      frames.push({ offsetMs: t, channel: "position", data: { lat: 12.97 + (gs * i) / 111_320, lon: 77.59 } });
      frames.push({ offsetMs: t + 10, channel: "vfr", data: { airspeed: gs, groundspeed: gs, heading: 0 } });
      if (withSensor) {
        frames.push({ offsetMs: t + 20, channel: "sysStatus", data: { sensorsPresent: 0x10, sensorsHealthy: 0x10 } });
      }
    }
    return frames;
  }

  it("is undefined when airspeed is only the GPS ground speed (no airspeed sensor)", () => {
    expect(estimateWind(copterFrames(8, false))).toBeUndefined();
  });

  it("averages the autopilot's own wind estimate when recorded", () => {
    const frames: TelemetryFrame[] = [];
    for (let i = 0; i < 10; i++) {
      frames.push({ offsetMs: i * 500, channel: "wind", data: { direction: 270, speed: 8, speedZ: 0 } });
    }
    expect(estimateWind(frames)).toMatchObject({ speedMs: 8, fromDirDeg: 270, method: "fc_estimate" });
  });

  it("sees a crosswind from the ground track when a real airspeed sensor is fitted", () => {
    // Heading north at 10 m/s airspeed; a 5 m/s wind from the west pushes
    // the ground track east.
    const frames: TelemetryFrame[] = [];
    for (let i = 0; i < 20; i++) {
      const t = i * 1000;
      const lat = 12.97 + (10 * i) / 111_320;
      const lon = 77.59 + (5 * i) / (111_320 * Math.cos(lat * DEG));
      frames.push({ offsetMs: t, channel: "position", data: { lat, lon } });
      frames.push({ offsetMs: t + 10, channel: "vfr", data: { airspeed: 10, groundspeed: Math.hypot(10, 5), heading: 0 } });
      frames.push({ offsetMs: t + 20, channel: "sysStatus", data: { sensorsPresent: 0x10, sensorsHealthy: 0x10 } });
    }
    const wind = estimateWind(frames);
    expect(wind?.method).toBe("vfr_diff");
    expect(wind?.speedMs).toBeCloseTo(5, 0);
    expect(wind?.fromDirDeg).toBeGreaterThanOrEqual(268);
    expect(wind?.fromDirDeg).toBeLessThanOrEqual(272);
  });
});
