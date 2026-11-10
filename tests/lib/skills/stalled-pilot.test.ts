/**
 * Built-in routing against a stalled pilot: an open pilot stream whose state
 * stopped arriving must not hold stop, kill or return home. They go to the
 * flight controller at once while a flight-controller path exists, and a
 * pilot that gives no answer to a sent action hands it to the flight
 * controller too.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import strings from "@/lib/cockpit-spec/setup-strings.json";
import { killSkill, pauseSkill, rthSkill } from "@/lib/skills/builtins";
import { viaPilot } from "@/lib/skills/builtins/_shared";
import {
  PILOT_ACTION_TIMEOUT_MS,
  handlePilotServerFrame,
  setPilotSender,
  usePilotLinkStore,
  type PilotOutboundFrame,
} from "@/lib/input/pilot-stream";
import type { PilotState } from "@/lib/hud/cockpit-frames";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { SkillContext, SkillProtocol } from "@/lib/skills/types";

const OK = { success: true, resultCode: 0, message: "" };

type Fake = Mock<() => Promise<typeof OK>>;
interface FakeFcPath {
  killSwitch: Fake;
  returnToLaunch: Fake;
  setFlightMode: Fake;
  pauseMission: Fake;
}

function fcPath(): FakeFcPath {
  return {
    killSwitch: vi.fn(async () => OK),
    returnToLaunch: vi.fn(async () => OK),
    setFlightMode: vi.fn(async () => OK),
    pauseMission: vi.fn(async () => OK),
  };
}

function ctxWith(fc: FakeFcPath): SkillContext {
  return {
    droneId: "drone-1",
    protocol: fc as unknown as SkillProtocol,
    armState: "armed",
    flightMode: "GUIDED",
    availableModes: [],
    missionState: null,
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
  };
}

let frames: PilotOutboundFrame[];

beforeEach(() => {
  frames = [];
  setPilotSender((f) => {
    frames.push(f);
    return true;
  }, "drone-1");
  handlePilotServerFrame("drone-1", { kind: "pilot", data: { control_mode: "ados" } });
});

afterEach(() => {
  vi.useRealTimers();
  setPilotSender(null);
  usePilotLinkStore.getState().set({ controlMode: null, agentFor: null });
  useNavStreamStore.setState({ byDrone: {} });
});

function pilotStateAt(at: number): void {
  useNavStreamStore.getState().setPilot("drone-1", { control_mode: "ados" } as unknown as PilotState, at);
}

describe("built-ins with a stalled pilot", () => {
  it("a live pilot keeps the route; a pilot state older than 2 s loses it", () => {
    const fc = fcPath();
    pilotStateAt(Date.now());
    expect(viaPilot(ctxWith(fc))).toBe(true);
    pilotStateAt(Date.now() - 2500);
    expect(viaPilot(ctxWith(fc))).toBe(false);
  });

  it("with no flight-controller path a stalled pilot still gets the action", () => {
    pilotStateAt(Date.now() - 5000);
    const ctx = { ...ctxWith(fcPath()), protocol: null, blindProtocol: null };
    expect(viaPilot(ctx)).toBe(true);
  });

  it.each([
    ["pause", pauseSkill, "setFlightMode"],
    ["kill", killSkill, "killSwitch"],
    ["rth", rthSkill, "returnToLaunch"],
  ] as const)("%s goes to the flight controller at once when the pilot stalled", async (_n, skill, method) => {
    pilotStateAt(Date.now() - 5000);
    const fc = fcPath();
    const started = Date.now();
    const r = await skill.activate(ctxWith(fc));
    expect(Date.now() - started).toBeLessThan(500);
    expect(fc[method]).toHaveBeenCalledTimes(1);
    expect(r).toEqual(OK);
    expect(frames.some((f) => f.op === "action")).toBe(false);
  });

  it.each([
    ["pause", pauseSkill, "setFlightMode"],
    ["kill", killSkill, "killSwitch"],
    ["rth", rthSkill, "returnToLaunch"],
  ] as const)("%s falls back to the flight controller when the pilot gives no answer", async (_n, skill, method) => {
    vi.useFakeTimers();
    pilotStateAt(Date.now());
    const fc = fcPath();
    const pending = skill.activate(ctxWith(fc));
    expect(frames.some((f) => f.op === "action")).toBe(true);
    expect(fc[method]).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PILOT_ACTION_TIMEOUT_MS + 10);
    await expect(pending).resolves.toEqual(OK);
    expect(fc[method]).toHaveBeenCalledTimes(1);
  });

  it("a pilot refusal is reported, not sent to the flight controller", async () => {
    pilotStateAt(Date.now());
    const fc = fcPath();
    const pending = rthSkill.activate(ctxWith(fc));
    const sent = frames.find((f) => f.op === "action") as Extract<PilotOutboundFrame, { op: "action" }>;
    handlePilotServerFrame("drone-1", { kind: "action_result", name: "rth", id: sent.id, ok: false, err: "no_home" });
    await expect(pending).resolves.toMatchObject({ success: false, message: strings.strings["refusal.no_home"] });
    expect(fc.returnToLaunch).not.toHaveBeenCalled();
  });
});
