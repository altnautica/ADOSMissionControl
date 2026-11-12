/**
 * @module export-flight-brief.test
 * @description Tests for the pure parts of the flight-brief PDF export: the
 * plan-statistics derivation (`computeBriefStats`), the file name
 * (`flightBriefFileName`), and the waypoint-row builder (`buildBriefRows`). The
 * actual `pdf().toBlob()` render needs a DOM/worker and is exercised in the app,
 * not here.
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";
import {
  computeBriefStats,
  flightBriefFileName,
  buildBriefRows,
  DEFAULT_CRUISE_SPEED_MPS,
} from "@/lib/pdf/export-flight-brief";
import type { Waypoint } from "@/lib/types";

function wp(overrides: Partial<Waypoint>): Waypoint {
  return {
    id: Math.random().toString(36).slice(2),
    lat: 0,
    lon: 0,
    alt: 0,
    ...overrides,
  };
}

describe("computeBriefStats", () => {
  it("returns honest zeros for an empty plan", () => {
    const stats = computeBriefStats([], "relative");
    expect(stats).toEqual({
      waypointCount: 0,
      distanceM: 0,
      durationS: 0,
      altMin: 0,
      altMax: 0,
      altFrame: null,
      openEnded: null,
    });
  });

  it("returns zero distance/duration but real alt range for a single waypoint", () => {
    const stats = computeBriefStats([wp({ alt: 42 })], "relative");
    expect(stats.waypointCount).toBe(1);
    expect(stats.distanceM).toBe(0);
    expect(stats.durationS).toBe(0);
    expect(stats.altMin).toBe(42);
    expect(stats.altMax).toBe(42);
  });

  it("derives altitude min/max from the waypoint altitudes", () => {
    const stats = computeBriefStats(
      [wp({ alt: 30 }), wp({ alt: 120 }), wp({ alt: 55 })],
      "relative",
    );
    expect(stats.altMin).toBe(30);
    expect(stats.altMax).toBe(120);
    expect(stats.waypointCount).toBe(3);
  });

  it("computes a positive distance and duration for a real leg", () => {
    // Two points ~1 km apart near the equator (0.009 deg lon ~= 1002 m). Not
    // at 0/0, which marks an item saved without a position.
    const wps = [wp({ lat: 1, lon: 0.001, alt: 50 }), wp({ lat: 1, lon: 0.01, alt: 50 })];
    const stats = computeBriefStats(wps, "relative", 10);
    expect(stats.distanceM).toBeGreaterThan(900);
    expect(stats.distanceM).toBeLessThan(1100);
    // The 50 m climb at the launch point (2.5 m/s), then distance / speed (10 m/s).
    expect(stats.durationS).toBeCloseTo(50 / 2.5 + stats.distanceM / 10, 3);
  });

  it("gives no altitude range across frames", () => {
    const stats = computeBriefStats(
      [wp({ alt: 520, frame: "absolute" }), wp({ alt: 50 })],
      "relative",
    );
    expect(stats.altFrame).toBe("mixed");
    const uniform = computeBriefStats([wp({ alt: 50 }), wp({ alt: 60 })], "terrain");
    expect(uniform.altFrame).toBe("terrain");
  });

  it("unrolls DO_JUMP repeats and flags a plan that never ends with its reason", () => {
    const loop = (repeat: number) => [
      wp({ id: "a", lat: 1, lon: 0.001, alt: 50 }),
      wp({
        id: "b", lat: 1, lon: 0.01, alt: 50,
        actions: [{ id: "j", command: "DO_JUMP", jumpTargetId: "a", param2: repeat }],
      }),
    ];
    const once = computeBriefStats(loop(0), "relative", 10);
    const thrice = computeBriefStats(loop(2), "relative", 10);
    expect(thrice.distanceM).toBeCloseTo(once.distanceM * 5, 0);
    expect(once.openEnded).toBeNull();
    expect(computeBriefStats(loop(-1), "relative", 10).openEnded).toBe("loop");
    const loiter = computeBriefStats(
      [wp({ lat: 1, lon: 0.001, alt: 50 }), wp({ lat: 1, lon: 0.01, alt: 50, command: "LOITER" })],
      "relative",
      10,
    );
    expect(loiter.openEnded).toBe("loiter");
  });

  it("defaults the cruise speed when none is passed", () => {
    const wps = [wp({ lat: 1, lon: 0.001, alt: 0 }), wp({ lat: 1, lon: 0.01, alt: 0 })];
    const withDefault = computeBriefStats(wps, "relative");
    const explicit = computeBriefStats(wps, "relative", DEFAULT_CRUISE_SPEED_MPS);
    expect(withDefault.durationS).toBe(explicit.durationS);
    expect(withDefault.durationS).toBeGreaterThan(0);
  });
});

describe("flightBriefFileName", () => {
  it("uses the plan name, as the other plan exports do", () => {
    expect(flightBriefFileName("Matterhorn SAR — Three-Pattern Search")).toBe(
      "Matterhorn SAR — Three-Pattern Search.pdf",
    );
  });

  it("falls back to the other exports' default for an unnamed plan", () => {
    expect(flightBriefFileName("")).toBe("mission.pdf");
    expect(flightBriefFileName("   ")).toBe("mission.pdf");
    expect(flightBriefFileName(undefined)).toBe("mission.pdf");
  });
});

describe("buildBriefRows", () => {
  it("assigns 1-based sequence numbers and defaults the command", () => {
    const rows = buildBriefRows(
      [
        wp({ lat: 12.9, lon: 77.6, alt: 30, command: "TAKEOFF" }),
        wp({ lat: 12.91, lon: 77.61, alt: 40, frame: "absolute" }),
      ],
      "relative",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      seq: 1,
      lat: 12.9,
      lon: 77.6,
      alt: 30,
      frame: "relative",
      command: "TAKEOFF",
    });
    expect(rows[1].seq).toBe(2);
    expect(rows[1].command).toBe("WAYPOINT");
    // Each row keeps its own frame; the brief never relabels it.
    expect(rows[1].frame).toBe("absolute");
  });
});
