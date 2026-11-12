/**
 * The trajectory preview HUD reads the drone's height above ground from the
 * path's own terrain samples. The rendered globe is not a valid source: before
 * its fine tiles load, a coarse tile answers a height kilometres below the real
 * ground, which turned a 30 m takeoff on a mountain into an altitude of tens of
 * kilometres at the start of the preview.
 * @license GPL-3.0-only
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { Cartesian3, JulianDate, type Clock, type Viewer } from "cesium";
import { useSimClock } from "@/hooks/use-sim-clock";
import { buildSampledProperties } from "@/lib/build-sampled-properties";
import { computeFlightPlan } from "@/lib/flight-plan";
import { useSimulationStore } from "@/stores/simulation-store";
import type { Waypoint } from "@/lib/types";

/** Ellipsoidal ground under the whole mission (a high alpine slope). */
const GROUND = 2800;
/** What a coarse, not yet refined globe tile answers for that ground. */
const COARSE_TILE_HEIGHT = -59_900;

const WAYPOINTS: Waypoint[] = [
  { id: "takeoff", lat: 45.9788, lon: 7.6595, alt: 30, command: "TAKEOFF", frame: "terrain" },
  { id: "search", lat: 45.98, lon: 7.66, alt: 50, command: "WAYPOINT", frame: "terrain" },
];

function makeViewer() {
  const listeners: Array<(clock: Clock) => void> = [];
  const clock = {
    onTick: {
      addEventListener: (fn: (clock: Clock) => void) => listeners.push(fn),
      removeEventListener: () => undefined,
    },
  } as unknown as Clock;
  const viewer = {
    clock,
    isDestroyed: () => false,
    scene: {
      requestRender: () => undefined,
      globe: { getHeight: () => COARSE_TILE_HEIGHT },
    },
  } as unknown as Viewer;
  return { viewer, tick: () => listeners.forEach((fn) => fn(clock)) };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useSimulationStore.getState().reset();
});

describe("trajectory preview altitude", () => {
  it("reports the height above the path's terrain from t = 0, not a coarse globe tile's height", () => {
    const flightPlan = computeFlightPlan(WAYPOINTS, 5);
    const positions = WAYPOINTS.map((wp) => Cartesian3.fromDegrees(wp.lon, wp.lat, GROUND + wp.alt));
    const sampled = buildSampledProperties(
      WAYPOINTS,
      flightPlan,
      positions,
      positions,
      [0, 1],
      GROUND,
      [GROUND, GROUND],
    )!;
    const { viewer, tick } = makeViewer();
    let now = 1_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);

    renderHook(() => useSimClock(viewer, sampled, flightPlan.totalDuration, true, flightPlan));

    // t = 0: on the ground at the launch point, before the takeoff climb.
    tick();
    expect(useSimulationStore.getState().syncedPosition?.altAgl).toBeCloseTo(0, 0);

    // Top of the takeoff climb (the first leg is the 12 s climb to 30 m).
    const climb = flightPlan.segments[0].duration;
    viewer.clock.currentTime = JulianDate.addSeconds(sampled.startJulian, climb, new JulianDate());
    now += 1000;
    tick();
    expect(useSimulationStore.getState().syncedPosition?.altAgl).toBeCloseTo(30, 0);
  });
});
