/**
 * @module sim-replay-store.test
 * @description Unit tests for the sim-replay store's parse→positions mapping:
 * `extractPositions` channel filtering, no-fix / invalid-frame rejection, and
 * altitude preference, plus the store's `clear` reset and the unsupported-format
 * branch of `loadFromFile`. Synthetic frames only — no real coordinates.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { TelemetryFrame } from "@/lib/telemetry-recorder";
import {
  decimateTrack,
  extractPositions,
  useSimReplayStore,
} from "@/stores/sim-replay-store";

describe("extractPositions", () => {
  it("keeps only position / globalPosition frames in order", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "position", data: { lat: 1.23, lon: 4.56, alt: 100 } },
      { offsetMs: 100, channel: "attitude", data: { roll: 0, pitch: 0, yaw: 0 } },
      { offsetMs: 200, channel: "globalPosition", data: { lat: 1.24, lon: 4.57, alt: 110, relativeAlt: 50 } },
      { offsetMs: 300, channel: "battery", data: { voltage: 16 } },
    ];
    const positions = extractPositions(frames);
    // amsl=true because the absolute `alt` channel supplied the altitude.
    expect(positions).toEqual([
      { lat: 1.23, lon: 4.56, alt: 100, amsl: true },
      { lat: 1.24, lon: 4.57, alt: 110, amsl: true },
    ]);
  });

  it("prefers absolute alt, falling back to relativeAlt then 0", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "position", data: { lat: 2, lon: 3, relativeAlt: 42 } },
      { offsetMs: 1, channel: "position", data: { lat: 2.1, lon: 3.1 } },
    ];
    // relativeAlt fallback and the 0 default are height-above-home, not MSL.
    expect(extractPositions(frames)).toEqual([
      { lat: 2, lon: 3, alt: 42, amsl: false },
      { lat: 2.1, lon: 3.1, alt: 0, amsl: false },
    ]);
  });

  it("skips 0/0 null-island no-fix frames", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "position", data: { lat: 0, lon: 0, alt: 0 } },
      { offsetMs: 1, channel: "position", data: { lat: 5, lon: 6, alt: 10 } },
    ];
    expect(extractPositions(frames)).toEqual([{ lat: 5, lon: 6, alt: 10, amsl: true }]);
  });

  it("skips frames with non-finite or out-of-range coordinates", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "position", data: { lat: Number.NaN, lon: 4.5, alt: 0 } },
      { offsetMs: 1, channel: "position", data: { lat: 95, lon: 4.5, alt: 0 } },
      { offsetMs: 2, channel: "position", data: { lat: 4.5, lon: 200, alt: 0 } },
      { offsetMs: 3, channel: "position", data: { lat: 4.5, lon: 4.5, alt: 7 } },
    ];
    expect(extractPositions(frames)).toEqual([{ lat: 4.5, lon: 4.5, alt: 7, amsl: true }]);
  });

  it("returns an empty array when there are no position frames", () => {
    const frames: TelemetryFrame[] = [
      { offsetMs: 0, channel: "attitude", data: { roll: 0 } },
    ];
    expect(extractPositions(frames)).toEqual([]);
  });
});

describe("useSimReplayStore", () => {
  beforeEach(() => {
    useSimReplayStore.getState().clear();
  });

  it("clear() resets track and error", () => {
    useSimReplayStore.setState({
      track: {
        positions: [{ lat: 1, lon: 2, alt: 3 }],
        renderPositions: [{ lat: 1, lon: 2, alt: 3 }],
        name: "x.bin",
      },
      error: { code: "parse-failed", detail: "boom" },
    });
    useSimReplayStore.getState().clear();
    expect(useSimReplayStore.getState().track).toBeNull();
    expect(useSimReplayStore.getState().error).toBeNull();
  });

  it("loadFromFile rejects an unsupported extension without a track", async () => {
    const file = new File([new Uint8Array([1, 2, 3])], "notes.csv", {
      type: "text/csv",
    });
    await useSimReplayStore.getState().loadFromFile(file);
    expect(useSimReplayStore.getState().track).toBeNull();
    // Typed error, carrying WHICH extension was rejected — a truncated log and
    // an unsupported one are different situations and used to look identical.
    expect(useSimReplayStore.getState().error).toEqual({
      code: "unsupported",
      detail: "csv",
    });
    expect(useSimReplayStore.getState().loading).toBe(false);
  });
});

describe("decimateTrack", () => {
  it("keeps the endpoints and drops collinear interior points", () => {
    // 200 points along a straight line: everything between the ends is within
    // tolerance of the segment, so only the two endpoints survive.
    const straight = Array.from({ length: 200 }, (_, i) => ({
      lat: 12.9,
      lon: 77.5 + i * 0.00001,
      alt: 50,
    }));
    const out = decimateTrack(straight, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(straight[0]);
    expect(out[1]).toEqual(straight[straight.length - 1]);
  });

  it("keeps a vertex whose deviation exceeds the tolerance", () => {
    // ~55m north of the straight line between the ends: far outside 2m.
    const dogleg = [
      { lat: 12.9, lon: 77.5, alt: 50 },
      { lat: 12.9005, lon: 77.505, alt: 50 },
      { lat: 12.9, lon: 77.51, alt: 50 },
    ];
    expect(decimateTrack(dogleg, 2)).toHaveLength(3);
    // With a tolerance wider than the deviation the corner is dropped.
    expect(decimateTrack(dogleg, 200)).toHaveLength(2);
  });

  it("passes a two-point track through untouched", () => {
    const pair = [
      { lat: 1, lon: 2, alt: 3 },
      { lat: 4, lon: 5, alt: 6 },
    ];
    expect(decimateTrack(pair)).toEqual(pair);
  });
});
