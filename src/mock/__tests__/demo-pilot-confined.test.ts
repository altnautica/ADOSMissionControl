/**
 * @module mock/demo-pilot-confined.test
 * @description The demo pilot's confined-place profile: the class is set by
 * the `place_class` action (refused while armed), and a scenario pins each
 * route-check state and the speed cap near the clearance limit through
 * `window.__adosDemoPilot`. A confined launch with a route too tight is
 * refused `route_infeasible`.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// Arming starts the flight log's weather and place lookups; keep them off the
// network so no request outlives the test file.
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => undefined }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => undefined }));

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { routeCheckReport } from "@/lib/hud/route-check";
import { requestPilotAction } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";

const ID = resolveNodeId("alpha-1");

function vehicle(): MockProtocol {
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
  expect(protocol).toBeInstanceOf(MockProtocol);
  return protocol as MockProtocol;
}

function pilot(): PilotState {
  const feed = useNavStreamStore.getState().byDrone[ID]?.pilot;
  expect(feed).toBeDefined();
  return feed!.data;
}

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  vehicle().flight.init({ armed: false, airborne: false, mode: "GUIDED" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo confined profile", () => {
  it("starts open and takes the confined class from the place_class action", async () => {
    expect(pilot().placeClass).toBe("open");
    await expect(requestPilotAction("place_class:confined")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().placeClass).toBe("confined");
    await expect(requestPilotAction("place_class:open")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().placeClass).toBe("open");
  });

  it("refuses a class change while armed", async () => {
    window.__adosDemoPilot!.pin({ armed: true });
    await expect(requestPilotAction("place_class:confined")).resolves.toEqual({ ok: false, err: "armed" });
  });

  it.each([
    ["feasible", "Route clear · keeps 0.58 m", null],
    ["unverified", "Route checked in flight at each leg's height · slow near walls", "confined-near"],
    ["infeasible", "Route too tight: leg 3→4 has 0.52 m, needs 0.58 m", "confined-near"],
  ] as const)("pins a %s route check, with the cap near the limit", (state, line, cap) => {
    const demo = window.__adosDemoPilot!;
    demo.pin(demo.confinedPins(state));
    vi.advanceTimersByTime(200);
    const p = pilot();
    expect(p.placeClass).toBe("confined");
    expect(p.routeCheck?.state).toBe(state);
    expect(routeCheckReport(p.routeCheck)?.line).toBe(line);
    expect(p.speedCap?.reason ?? null).toBe(cap);
    if (cap) expect(p.speedCap?.vHMps).toBe(0.5);
  });

  it("refuses a confined launch whose route is too tight", async () => {
    const demo = window.__adosDemoPilot!;
    demo.pin(demo.confinedPins("infeasible"));
    await expect(requestPilotAction("launch", { after: "mission" })).resolves.toEqual({
      ok: false,
      err: "route_infeasible",
    });
  });

  it("checks the route only for a launch into the mission, as the pilot does", async () => {
    const demo = window.__adosDemoPilot!;
    demo.pin(demo.confinedPins("infeasible"));
    const hold = await requestPilotAction("launch", { after: "hold" });
    expect(hold.err).not.toBe("route_infeasible");
  });

  it("refuses a confined launch into a mission with an unchecked waypoint", async () => {
    const demo = window.__adosDemoPilot!;
    const pins = demo.confinedPins("unverified");
    demo.pin({ ...pins, route_check: { ...(pins.route_check as object), unchecked: [4] } });
    vi.advanceTimersByTime(200);
    expect(routeCheckReport(pilot().routeCheck)?.line).toContain("4");
    await expect(requestPilotAction("launch", { after: "mission" })).resolves.toEqual({
      ok: false,
      err: "route_unchecked",
    });
  });

  it("an operator's switch to open drops the confined route check and its speed cap", async () => {
    const demo = window.__adosDemoPilot!;
    demo.pin(demo.confinedPins("infeasible"));
    vi.advanceTimersByTime(200);
    expect(pilot().routeCheck?.state).toBe("infeasible");
    await expect(requestPilotAction("place_class:open")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().placeClass).toBe("open");
    expect(pilot().routeCheck).toBeNull();
    expect(pilot().speedCap).toBeNull();
  });

  it("an operator's class change replaces a pinned one", async () => {
    const demo = window.__adosDemoPilot!;
    demo.pin(demo.confinedPins("feasible"));
    vi.advanceTimersByTime(200);
    expect(pilot().placeClass).toBe("confined");
    await expect(requestPilotAction("place_class:open")).resolves.toEqual({ ok: true });
    vi.advanceTimersByTime(200);
    expect(pilot().placeClass).toBe("open");
  });
});
