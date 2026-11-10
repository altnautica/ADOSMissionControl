/**
 * Pause is refused while the flight controller flies a failsafe return or
 * landing (also on the flight-controller fallback), and Disarm (with the arm
 * binding's flip to it) is offered only on the ground.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { disarmSkill } from "../builtins/disarm";
import { pauseSkill } from "../builtins/pause";
import { rthSkill } from "../builtins/rth";
import { resolveBoundSkillId } from "../bound-skill";
import { resetCommandedModes } from "../flight-facts";
import type { SkillContext } from "../types";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import { useTelemetryStore } from "@/stores/telemetry-store";

const OK = { success: true, resultCode: 0, message: "" };

const setFlightMode = vi.fn(async () => OK);

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  const protocol = {
    setFlightMode,
    pauseMission: vi.fn(async () => OK),
    returnToLaunch: vi.fn(async () => OK),
    disarm: vi.fn(async () => OK),
  };
  return {
    droneId: "d1",
    protocol: protocol as never,
    armState: "armed",
    flightMode: "LOITER",
    availableModes: [],
    missionState: null,
    supports: () => true,
    autonomousNav: "yes",
    checklistReady: true,
    confirm: async () => ({ approved: true }) as never,
    notify: () => undefined,
    ...over,
  } as SkillContext;
}

function setHeight(m: number) {
  useTelemetryStore.getState().position.push({ timestamp: Date.now(), lat: 1, lon: 1, alt: m, relativeAlt: m } as never);
}

describe("Pause during a flight-controller failsafe", () => {
  beforeEach(() => {
    resetCommandedModes();
    setFlightMode.mockClear();
  });

  it("is refused while the FC flies an RTL nobody here asked for", async () => {
    const c = ctx({ flightMode: "RTL" });
    expect(pauseSkill.getState(c)).toMatchObject({ kind: "disabled" });
    const r = await pauseSkill.activate(c);
    expect(r).toMatchObject({ success: false, message: "failsafe" });
    expect(setFlightMode).not.toHaveBeenCalled();
  });

  it("is refused while the heartbeat reports EMERGENCY", () => {
    expect(pauseSkill.getState(ctx({ flightMode: "AUTO", systemStatus: 6 }))).toMatchObject({ kind: "disabled" });
  });

  it("stays available in a return this ground station commanded", async () => {
    const c = ctx({ flightMode: "RTL" });
    await rthSkill.activate(c);
    expect(pauseSkill.getState(c).kind).not.toBe("disabled");
  });
});

describe("Disarm only on the ground", () => {
  beforeEach(() => {
    useNavStreamStore.setState({ byDrone: {} });
    useTelemetryStore.getState().clear();
  });
  afterEach(() => useTelemetryStore.getState().clear());

  it("is disabled and the arm binding never flips to it in the air", () => {
    setHeight(41);
    expect(disarmSkill.getState(ctx())).toMatchObject({ kind: "disabled" });
    expect(resolveBoundSkillId("arm", "armed", { missionState: null, droneId: "d1" })).toBe("arm");
  });

  it("is offered on the ground", () => {
    setHeight(0.2);
    expect(disarmSkill.getState(ctx()).kind).toBe("idle");
    expect(resolveBoundSkillId("arm", "armed", { missionState: null, droneId: "d1" })).toBe("disarm");
  });
});
