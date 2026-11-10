/**
 * @module mock/demo-pilot-pins.test
 * @description The demo pilot reaches the cockpit states a real pilot
 * reports: it advertises the `goto` surface op and flies Fly Here, and an FC
 * failsafe and a tuning step pinned through `window.__adosDemoPilot.pin` reach
 * the pilot frame and the flight-state chip, with Pause refused during the
 * failsafe. Pins and stick input never carry over from one drone's session to
 * the next, and the console handle goes away with the pilot.
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PilotState } from "@/lib/hud/cockpit-frames";
import { chipFacts, chipSecondary, flightStateChip, type ChipView } from "@/lib/hud/flight-state";
import { requestPilotAction, sendPilotInput } from "@/lib/input/pilot-stream";
import { mockEngine } from "@/mock/engine";
import { mockPilot } from "@/mock/mock-pilot";
import { MockProtocol } from "@/mock/mock-protocol";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { resolveNodeId } from "@/stores/node-registry";
import { useSettingsStore } from "@/stores/settings-store";

const ID = resolveNodeId("alpha-1");
const OTHER = resolveNodeId("bravo-2");

function handle() {
  return window.__adosDemoPilot;
}

function vehicle(): MockProtocol {
  const protocol = useDroneManager.getState().drones.get(ID)?.protocol;
  expect(protocol).toBeInstanceOf(MockProtocol);
  return protocol as MockProtocol;
}

function pilot(id = ID): PilotState {
  const feed = useNavStreamStore.getState().byDrone[id]?.pilot;
  expect(feed).toBeDefined();
  return feed!.data;
}

function chip(): ChipView {
  const feed = useNavStreamStore.getState().byDrone[ID]!.pilot!;
  return flightStateChip(
    chipFacts(feed.data, Date.now() - feed.receivedAt, { homeDistM: null, modeDetail: null, completeAgeMs: null }),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  void useSettingsStore.setState({ _hasHydrated: true, demoMode: true });
  mockEngine.start(50);
  vehicle().flight.init({ armed: true, airborne: true, mode: "AUTO" });
  mockPilot.start(ID);
  vi.advanceTimersByTime(200);
});

afterEach(() => {
  mockPilot.stop();
  mockEngine.stop();
  useNavStreamStore.getState().clear(ID);
  useNavStreamStore.getState().clear(OTHER);
  void useSettingsStore.setState({ demoMode: false });
  vi.useRealTimers();
});

describe("demo pilot surface ops", () => {
  it("advertises goto and flies Fly Here itself", async () => {
    expect(pilot().surfaceOps).toContain("goto");
    expect((await requestPilotAction("goto", { lat: 12.97, lon: 77.59, alt_m: 30 })).ok).toBe(true);
    expect(vehicle().flight.mode).toBe("GUIDED");
    expect(pilot().owner).toBe("pilot");
  });

  it("refuses a goto on the ground", async () => {
    await requestPilotAction("land");
    expect(await requestPilotAction("goto", { lat: 12.97, lon: 77.59, alt_m: 30 })).toEqual({ ok: false, err: "landed" });
  });
});

describe("pinned FC failsafe", () => {
  it("reaches the pilot frame and the chip's FAILSAFE line", () => {
    handle()!.pin({ fc_failsafe: true, failsafe_cause: "rc_or_failsafe" });
    vi.advanceTimersByTime(100);
    expect(pilot()).toMatchObject({ fcFailsafe: true, failsafeCause: "rc_or_failsafe" });
    const feed = useNavStreamStore.getState().byDrone[ID]!.pilot!;
    const facts = chipFacts(feed.data, 0, { homeDistM: null, modeDetail: null, completeAgeMs: null });
    expect(chipSecondary(facts)[0]?.text).toBe("FAILSAFE");
  });

  it("refuses Pause and Fly Here with failsafe while it is set, and leaves the FC flying", async () => {
    handle()!.pin({ fc_failsafe: true, failsafe_cause: "fc" });
    expect(await requestPilotAction("pause")).toEqual({ ok: false, err: "failsafe" });
    expect(await requestPilotAction("goto", { lat: 12.97, lon: 77.59, alt_m: 30 })).toEqual({ ok: false, err: "failsafe" });
    expect(vehicle().flight.mode).toBe("AUTO");
  });

  it("clears when the operator takes control", async () => {
    handle()!.pin({ fc_failsafe: true, failsafe_cause: "fc" });
    expect((await requestPilotAction("take_control")).ok).toBe(true);
    expect(pilot()).toMatchObject({ fcFailsafe: false, failsafeCause: null });
    expect((await requestPilotAction("pause")).ok).toBe(true);
  });
});

describe("pinned tuning step", () => {
  it("shows TUNING with the step on the chip", () => {
    handle()!.pin({ owner: "tuning", setup_step: "rate_roll" });
    vi.advanceTimersByTime(100);
    expect(pilot()).toMatchObject({ owner: "tuning", setupStep: "rate_roll" });
    expect(chip()).toMatchObject({ ruleId: "tuning", text: "TUNING · RATE_ROLL" });
  });
});

describe("demo pilot sessions", () => {
  it("starts each drone's session without the last one's pins or stick input", () => {
    handle()!.pin({ fc_failsafe: true, failsafe_cause: "fc" });
    sendPilotInput([0, 0, 0, 0], 0);
    mockPilot.start(OTHER);
    vi.advanceTimersByTime(100);
    expect(pilot(OTHER)).toMatchObject({ fcFailsafe: false, inputAgeMs: null });
  });

  it("removes the console handle when it stops", () => {
    expect(handle()).toBeDefined();
    mockPilot.stop();
    expect(handle()).toBeUndefined();
  });
});
