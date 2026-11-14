/**
 * Resume and Take control are refused while the flight controller flies a
 * failsafe return or landing, with the same text as Pause: either would
 * override the FC's own recovery. Outside a failsafe both stay offered.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resumeSkill } from "../builtins/resume";
import { takeControlSkill } from "../builtins/take-control";
import { pauseSkill } from "../builtins/pause";
import { resetCommandedModes } from "../flight-facts";
import { refusalText } from "@/lib/hud/refusal";
import { parsePilotState } from "@/lib/hud/cockpit-frames";
import { setPilotSender } from "@/lib/input/pilot-stream";
import pilotFixture from "@/lib/cockpit/layers/fixtures/pilot-frame.json";
import type { SkillContext } from "../types";
import { useNavStreamStore } from "@/stores/nav-stream-store";

const OK = { success: true, resultCode: 0, message: "" };
const FAILSAFE = { kind: "disabled", reason: refusalText("failsafe") };

function ctx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: "d1",
    protocol: { resumeMission: vi.fn(async () => OK), setFlightMode: vi.fn(async () => OK) } as never,
    armState: "armed",
    flightMode: "LOITER",
    availableModes: [],
    missionState: "paused",
    supports: () => true,
    autonomousNav: "yes",
    checklistReady: true,
    confirm: async () => ({ approved: true }) as never,
    notify: () => undefined,
    ...over,
  } as SkillContext;
}

function pilotSays(fcFailsafe: boolean) {
  const data = parsePilotState({ ...pilotFixture, fc_failsafe: fcFailsafe, failsafe_cause: fcFailsafe ? "fc" : null });
  useNavStreamStore.setState({ byDrone: { d1: { pilot: { data, receivedAt: Date.now() } } } as never });
}

describe("Resume and Take control during a flight-controller failsafe", () => {
  beforeEach(() => {
    resetCommandedModes();
    setPilotSender((() => true) as never, "d1");
  });
  afterEach(() => {
    setPilotSender(null);
    useNavStreamStore.setState({ byDrone: {} });
  });

  it("refuses both, as Pause, while the pilot reports an FC failsafe", () => {
    pilotSays(true);
    expect(pauseSkill.getState(ctx())).toEqual(FAILSAFE);
    expect(resumeSkill.getState(ctx())).toEqual(FAILSAFE);
    expect(takeControlSkill.getState(ctx())).toEqual(FAILSAFE);
  });

  it("refuses Resume in an RTL nobody here asked for once the pilot is gone", () => {
    setPilotSender(null);
    expect(resumeSkill.getState(ctx({ flightMode: "RTL" }))).toEqual(FAILSAFE);
  });

  it("offers both outside a failsafe", () => {
    pilotSays(false);
    expect(resumeSkill.getState(ctx()).kind).toBe("idle");
    expect(takeControlSkill.getState(ctx()).kind).toBe("idle");
  });
});
