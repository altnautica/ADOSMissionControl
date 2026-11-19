/**
 * @module mock/demo-pilot-liftoff.test
 * @description The demo pilot frame carries what a real pilot reports for
 * the sticks and the steady take-off: the flown profile's stick limits, the
 * sticks' command while they fly, the supervised lift-off phases on a
 * launch (probe first, learned after, the balance row turning OK), the
 * standard take-off pin running none, and `airframe_reset` refused in the
 * air.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/environment/weather-provider", () => ({ getWeatherSnapshot: async () => undefined }));
vi.mock("@/lib/geocoding/reverse", () => ({ reverseGeocode: async () => undefined }));

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { requestPilotAction, sendPilotInput } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { DEMO_LIFTOFF_PHASES } from "@/mock/mock-pilot-liftoff";
import { DEMO_STANDARD_TAKEOFF_PIN, DEMO_STICK_LIMITS } from "@/mock/mock-pilot-wire";
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

function balance(): string | undefined {
  return pilot().readiness.find((r) => r.id === "airframe_balance")?.msg;
}

/** Every lift-off phase the frames show over `ms`. */
function phasesOver(ms: number): string[] {
  const seen: string[] = [];
  for (let t = 0; t < ms; t += 100) {
    vi.advanceTimersByTime(100);
    const phase = pilot().sequence?.liftoff?.phase;
    if (phase && seen[seen.length - 1] !== phase) seen.push(phase);
  }
  return seen;
}

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  vehicle().flight.init({ armed: false, airborne: false, mode: "LOITER" });
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

describe("demo stick limits", () => {
  it("carries the flown profile's row", async () => {
    expect(pilot().profileLimits?.vHMps).toBe(7);
    expect(pilot().profileLimits?.stopM).toBeCloseTo(12.6, 2);
    expect((await requestPilotAction("profile:sport")).ok).toBe(true);
    vi.advanceTimersByTime(100);
    expect(pilot().profileLimits?.vHMps).toBe(10);
    expect(pilot().profileLimits?.stopM).toBeCloseTo(24, 2);
    expect(DEMO_STICK_LIMITS.cine.stop_m).toBeCloseTo(3.45, 2);
  });

  it("reports the sticks' command while they fly", () => {
    vehicle().flight.init({ armed: true, airborne: true, mode: "GUIDED" });
    sendPilotInput([0, 1, 0, 0], 0);
    vi.advanceTimersByTime(100);
    const stick = pilot().stick;
    expect(pilot().owner).toBe("pilot");
    expect(stick?.askNeMps[0]).toBeCloseTo(7, 5);
    expect(stick?.askNeMps[1]).toBeCloseTo(0, 5);
  });
});

describe("demo steady take-off", () => {
  it("walks the lift-off phases on launch, probing first and learned after", async () => {
    expect(balance()).toMatch(/learning/);
    expect((await requestPilotAction("launch", { alt_m: 5 })).ok).toBe(true);
    expect(pilot().sequence?.liftoff?.trim).toBe("probe");
    const phases = phasesOver(6000);
    expect(phases).toEqual(DEMO_LIFTOFF_PHASES.map((p) => p.phase));
    expect(pilot().sequence).toBeNull();
    expect(balance()).toBe("Balance: OK.");
    // The next flight from the ground flies the learned trim.
    vehicle().flight.init({ armed: false, airborne: false, mode: "LOITER" });
    vi.advanceTimersByTime(100);
    await requestPilotAction("launch", { alt_m: 5 });
    vi.advanceTimersByTime(100);
    expect(pilot().sequence?.liftoff?.trim).toBe("learned");
  });

  it("runs no lift-off under the standard take-off pin", async () => {
    window.__adosDemoPilot!.pin(DEMO_STANDARD_TAKEOFF_PIN);
    await requestPilotAction("launch", { alt_m: 5 });
    expect(phasesOver(1000)).toEqual([]);
  });

  it("resets the balance on the ground and refuses it in the air", async () => {
    await requestPilotAction("launch", { alt_m: 5 });
    phasesOver(6000);
    expect(balance()).toBe("Balance: OK.");
    expect(await requestPilotAction("airframe_reset")).toEqual({ ok: false, err: "airborne" });
    vehicle().flight.init({ armed: false, airborne: false, mode: "LOITER" });
    vi.advanceTimersByTime(100);
    expect((await requestPilotAction("airframe_reset")).ok).toBe(true);
    vi.advanceTimersByTime(100);
    expect(balance()).toMatch(/learning/);
  });
});
