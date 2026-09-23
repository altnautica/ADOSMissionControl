/**
 * The live PID strip reads ATTITUDE body rates (rad/s), shows deg/s, drops
 * samples older than the telemetry freshness window and never reports a
 * vibration level it has no data for.
 */

import { describe, expect, it } from "vitest";
import { computeLivePidStats } from "@/components/fc/pid/PidLiveAnalysis";
import type { AttitudeData, VibrationData } from "@/lib/types";

const NOW = 1_000_000;

function attitude(t: number, rollSpeed: number): AttitudeData {
  return { timestamp: t, roll: 0, pitch: 0, yaw: 0, rollSpeed, pitchSpeed: 0, yawSpeed: 0 };
}

function vibration(t: number, v: number): VibrationData {
  return { timestamp: t, vibrationX: v, vibrationY: v, vibrationZ: v, clipping0: 0, clipping1: 0, clipping2: 0 };
}

describe("computeLivePidStats", () => {
  it("flags oscillation for rad/s body rates that exceed the deg/s threshold", () => {
    // Alternating +-0.5 rad/s is ~29 deg/s standard deviation.
    const samples = Array.from({ length: 20 }, (_, i) => attitude(NOW - 1000 + i * 50, i % 2 ? 0.5 : -0.5));
    const stats = computeLivePidStats(samples, vibration(NOW, 5), NOW);
    expect(stats.hasOscillation).toBe(true);
    expect(stats.rollRms).toBeCloseTo(0.5 * (180 / Math.PI), 3);
  });

  it("ignores samples older than the freshness window", () => {
    const samples = Array.from({ length: 20 }, (_, i) => attitude(NOW - 60_000 + i * 50, i % 2 ? 0.5 : -0.5));
    const stats = computeLivePidStats(samples, vibration(NOW - 60_000, 5), NOW);
    expect(stats.hasData).toBe(false);
    expect(stats.hasOscillation).toBe(false);
    expect(stats.vibe).toBe("unknown");
  });

  it("reports vibration as unknown when none has arrived", () => {
    const stats = computeLivePidStats([attitude(NOW - 100, 0)], undefined, NOW);
    expect(stats.vibe).toBe("unknown");
  });

  it("grades fresh vibration", () => {
    expect(computeLivePidStats([attitude(NOW, 0)], vibration(NOW - 100, 5), NOW).vibe).toBe("good");
    expect(computeLivePidStats([attitude(NOW, 0)], vibration(NOW - 100, 40), NOW).vibe).toBe("bad");
  });
});
