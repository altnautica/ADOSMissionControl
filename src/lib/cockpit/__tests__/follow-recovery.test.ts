/**
 * @module cockpit/follow-recovery.test
 * @description Follow-me recovery in the cockpit: the shared waiting-prompt
 * rule against the shared case table, every prompt action's transport, the
 * prompt's keys, and the recovery line the range panel shows.
 * @license GPL-3.0-only
 */

import { describe, expect, it, vi } from "vitest";

import promptCases from "@/lib/hud/fixtures/follow-prompt-cases.json";
import { followPrompt, FOLLOW_PROMPT_ACTIONS } from "@/lib/hud/follow-prompt";
import { parseFollowState } from "@/lib/hud/nav-types";
import {
  followActionForKey,
  followRecoveryLine,
  runFollowAction,
  type FollowActionDeps,
} from "@/lib/cockpit/follow-recovery";

function deps(over: Partial<FollowActionDeps> = {}): FollowActionDeps {
  return {
    put: vi.fn(async () => true),
    flight: vi.fn(async () => {}),
    startPick: vi.fn(),
    seq: 4,
    ...over,
  };
}

const NO_MODS = { shiftKey: false, ctrlKey: false, altKey: false, metaKey: false };

describe("followPrompt (shared case table)", () => {
  for (const c of promptCases) {
    it(c.name, () => {
      const state = parseFollowState(c.state);
      expect(state).not.toBeNull();
      expect(followPrompt(state!)).toEqual(c.expect);
    });
  }
});

describe("runFollowAction", () => {
  it("search again writes the next operator_resume_seq to the follow-me config", async () => {
    const d = deps();
    expect(await runFollowAction("resume", d)).toEqual({ ok: true });
    expect(d.put).toHaveBeenCalledWith("operator_resume_seq", 5);
  });

  it("stop following writes active = false", async () => {
    const d = deps();
    expect(await runFollowAction("stop", d)).toEqual({ ok: true });
    expect(d.put).toHaveBeenCalledWith("active", false);
  });

  it("return home and land dispatch the built-ins", async () => {
    const d = deps();
    await runFollowAction("rth", d);
    await runFollowAction("land", d);
    expect(d.flight).toHaveBeenNthCalledWith(1, "rth");
    expect(d.flight).toHaveBeenNthCalledWith(2, "land");
    expect(d.put).not.toHaveBeenCalled();
  });

  it("pick a target arms the pick and writes nothing", async () => {
    const d = deps();
    expect(await runFollowAction("redesignate", d)).toEqual({ ok: true });
    expect(d.startPick).toHaveBeenCalledOnce();
    expect(d.put).not.toHaveBeenCalled();
  });

  it("reports a write with no path or one that throws, never rejecting", async () => {
    expect((await runFollowAction("stop", deps({ put: async () => false }))).ok).toBe(false);
    const thrown = await runFollowAction("resume", deps({ put: async () => Promise.reject(new Error("refused")) }));
    expect(thrown).toEqual({ ok: false, err: "refused" });
    const flight = await runFollowAction("land", deps({ flight: async () => Promise.reject(new Error("no link")) }));
    expect(flight).toEqual({ ok: false, err: "no link" });
  });
});

describe("followActionForKey", () => {
  it("maps R P H L X to the offered actions only, never with a modifier", () => {
    const all = FOLLOW_PROMPT_ACTIONS;
    expect(["r", "p", "h", "l", "x"].map((key) => followActionForKey({ key, ...NO_MODS }, all))).toEqual([
      "resume",
      "redesignate",
      "rth",
      "land",
      "stop",
    ]);
    expect(followActionForKey({ key: "R", ...NO_MODS }, all)).toBe("resume");
    expect(followActionForKey({ key: "r", ...NO_MODS, shiftKey: true }, all)).toBeNull();
    expect(followActionForKey({ key: "l", ...NO_MODS, ctrlKey: true }, all)).toBeNull();
    expect(followActionForKey({ key: "r", ...NO_MODS }, ["redesignate", "rth", "land", "stop"])).toBeNull();
  });
});

describe("followRecoveryLine", () => {
  it("names the seconds left, the search step, the vantage and the occluder while searching", () => {
    const f = parseFollowState({
      active: true,
      phase: "searching",
      reacquire_remaining_s: 9.46,
      search_step: 1,
      vantage_state: "arrived",
      occluder: { ne: [1, 2], kind: "narrow" },
    })!;
    expect(followRecoveryLine(f)).toBe("10 s · step 2 · Arrived · Behind a trunk or column");
  });

  it("carries no step outside searching", () => {
    const f = parseFollowState({ active: true, phase: "repositioning", reacquire_remaining_s: 3.2, search_step: 0, vantage_state: "enroute" })!;
    expect(followRecoveryLine(f)).toBe("4 s · On the way");
  });

  it("is null outside the recovery phases", () => {
    for (const phase of ["following", "holding", "holding-await-operator", "idle"]) {
      expect(followRecoveryLine(parseFollowState({ active: true, phase, reacquire_remaining_s: 5 })!)).toBeNull();
    }
  });
});
