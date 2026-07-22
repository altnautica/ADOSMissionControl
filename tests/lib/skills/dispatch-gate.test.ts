/**
 * Tests for the skill gating pipeline: the single activate() seam that every
 * input source (keyboard, gamepad, Skill Bar, action panel) funnels through.
 * Asserts the gate order — disabled gate (toast, no dialog), arm-requirement,
 * confirm, idempotency debounce, and the toggle-off short-circuit — plus the
 * built-in arm adapter wrapping protocol.arm() behind a confirm.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  activate,
  deactivate,
  getChargeCount,
  getCooldownState,
} from "@/lib/skills";
import { useSkillRegistry } from "@/lib/skills/registry";
import { armSkill } from "@/lib/skills/builtins";
import type {
  Skill,
  SkillContext,
  SkillState,
  ConfirmPolicy,
} from "@/lib/skills/types";

/** Reset the registry to an empty store between tests. */
function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

/** A controllable context with spies for confirm + notify. */
function makeCtx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: "drone-1",
    protocol: null,
    armState: "disarmed",
    flightMode: "STABILIZE",
    availableModes: [],
    previousMode: "STABILIZE",
    supports: () => true,
    checklistReady: true,
    confirm: vi.fn(async () => true),
    notify: vi.fn(),
    ...over,
  };
}

/** A fake one-shot skill whose state + activate are test-controlled. */
function makeFakeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: "fake",
    label: "skills.fake",
    icon: "Box",
    category: "flight",
    source: "builtin",
    toggle: false,
    getState: () => ({ kind: "idle" }) as SkillState,
    activate: vi.fn(async () => {}),
    ...over,
  };
}

describe("skill dispatch gate", () => {
  beforeEach(() => {
    clearRegistry();
    vi.useRealTimers();
  });

  it("no-ops when the skill is not registered", async () => {
    const ctx = makeCtx();
    await activate("missing", ctx);
    // Nothing to assert beyond not throwing; confirm/notify untouched.
    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(ctx.notify).not.toHaveBeenCalled();
  });

  it("disabled gate surfaces the reason and never opens a dialog", async () => {
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      getState: () => ({ kind: "disabled", reason: "skills.reason.noFcLink" }),
      activate: activateFn,
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx();
    await activate("fake", ctx);

    expect(ctx.notify).toHaveBeenCalledWith("skills.reason.noFcLink", "warning");
    expect(ctx.confirm).not.toHaveBeenCalled();
    expect(activateFn).not.toHaveBeenCalled();
  });

  it("blocks a disarmed-only skill while the vehicle is armed", async () => {
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      armRequirement: "disarmed",
      activate: activateFn,
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ armState: "armed" });
    await activate("fake", ctx);

    expect(ctx.notify).toHaveBeenCalledWith("skills.reason.alreadyArmed", "warning");
    expect(activateFn).not.toHaveBeenCalled();
  });

  it("blocks an armed-only skill while the vehicle is disarmed", async () => {
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      armRequirement: "armed",
      activate: activateFn,
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ armState: "disarmed" });
    await activate("fake", ctx);

    expect(ctx.notify).toHaveBeenCalledWith("skills.reason.notArmed", "warning");
    expect(activateFn).not.toHaveBeenCalled();
  });

  it("requires a confirm and runs activate only when confirmed", async () => {
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      confirm: {
        title: "t",
        message: "m",
        confirmLabel: "c",
        variant: "danger",
      },
      activate: activateFn,
    });
    useSkillRegistry.getState().register(skill);

    const confirm = vi.fn(async () => true);
    const ctx = makeCtx({ confirm });
    await activate("fake", ctx);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(activateFn).toHaveBeenCalledTimes(1);
  });

  it("does not run activate when the confirm is cancelled", async () => {
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      confirm: {
        title: "t",
        message: "m",
        confirmLabel: "c",
        variant: "danger",
      },
      activate: activateFn,
    });
    useSkillRegistry.getState().register(skill);

    const confirm = vi.fn(async () => false);
    const ctx = makeCtx({ confirm });
    await activate("fake", ctx);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(activateFn).not.toHaveBeenCalled();
  });

  it("debounces a repeated one-shot inside the cooldown window", async () => {
    // The dispatcher's per-(drone,skill) debounce map is a module singleton;
    // a unique id keeps this test isolated from any other in the file.
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({ id: "debounce-a", activate: activateFn });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ droneId: "drone-debounce-a" });
    await activate("debounce-a", ctx);
    await activate("debounce-a", ctx);

    // The second press lands inside the debounce window and is swallowed.
    expect(activateFn).toHaveBeenCalledTimes(1);
  });

  it("allows a one-shot again after the debounce window elapses", async () => {
    // Unique id + drone so the shared cooldown map starts clean for this case.
    const nowSpy = vi.spyOn(Date, "now");
    const activateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({ id: "debounce-b", activate: activateFn });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ droneId: "drone-debounce-b" });
    nowSpy.mockReturnValue(1_000);
    await activate("debounce-b", ctx);
    // Past the 750 ms debounce window.
    nowSpy.mockReturnValue(2_000);
    await activate("debounce-b", ctx);

    expect(activateFn).toHaveBeenCalledTimes(2);
    nowSpy.mockRestore();
  });

  it("toggle-off short-circuits to deactivate when the skill is active", async () => {
    const activateFn = vi.fn(async () => {});
    const deactivateFn = vi.fn(async () => {});
    const skill = makeFakeSkill({
      toggle: true,
      getState: () => ({ kind: "active" }),
      activate: activateFn,
      deactivate: deactivateFn,
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx();
    await activate("fake", ctx);

    expect(deactivateFn).toHaveBeenCalledTimes(1);
    expect(activateFn).not.toHaveBeenCalled();
  });

  it("deactivate no-ops for a skill without a deactivate handler", async () => {
    const skill = makeFakeSkill({ toggle: false });
    useSkillRegistry.getState().register(skill);
    const ctx = makeCtx();
    // Should resolve without throwing.
    await expect(deactivate("fake", ctx)).resolves.toBeUndefined();
  });
});

describe("rejected command results", () => {
  beforeEach(() => clearRegistry());

  /** A one-shot with a real cooldown and a charge budget, so both spends are
   * observable. Unique ids per test keep the module-singleton clocks clean. */
  function budgetedSkill(id: string, over: Partial<Skill> = {}): Skill {
    return makeFakeSkill({
      id,
      cooldownMs: 5000,
      charges: { current: 2, max: 2, rechargeMs: 60_000 },
      ...over,
    });
  }

  it("surfaces the vehicle's refusal and spends neither charge nor cooldown", async () => {
    const skill = budgetedSkill("rejected-a", {
      activate: async () => ({
        success: false,
        resultCode: 2,
        message: "Rejected by the flight controller",
      }),
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ droneId: "drone-rejected-a" });
    await activate("rejected-a", ctx);

    expect(ctx.notify).toHaveBeenCalledWith(
      "Rejected by the flight controller",
      "error",
    );
    // The command did no work, so nothing may be spent on it: the charge
    // budget is untouched and no cooldown window greys the control.
    expect(getChargeCount("drone-rejected-a", skill)).toEqual({
      current: 2,
      max: 2,
    });
    expect(getCooldownState("drone-rejected-a", "rejected-a")).toBeNull();
  });

  it("falls back to the shared reason when the refusal carries no message", async () => {
    const skill = budgetedSkill("rejected-b", {
      activate: async () => ({ success: false, resultCode: -1, message: "" }),
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ droneId: "drone-rejected-b" });
    await activate("rejected-b", ctx);

    expect(ctx.notify).toHaveBeenCalledWith(
      "skills.reason.commandRejected",
      "error",
    );
  });

  it("spends the charge and arms the cooldown on an accepted result", async () => {
    const skill = budgetedSkill("accepted-a", {
      activate: async () => ({
        success: true,
        resultCode: 0,
        message: "Accepted",
      }),
    });
    useSkillRegistry.getState().register(skill);

    const ctx = makeCtx({ droneId: "drone-accepted-a" });
    await activate("accepted-a", ctx);

    expect(ctx.notify).not.toHaveBeenCalled();
    expect(getChargeCount("drone-accepted-a", skill)).toEqual({
      current: 1,
      max: 2,
    });
    expect(getCooldownState("drone-accepted-a", "accepted-a")).not.toBeNull();
  });
});

describe("built-in arm adapter", () => {
  beforeEach(() => clearRegistry());

  it("wraps protocol.arm() behind a danger confirm", async () => {
    useSkillRegistry.getState().register(armSkill);

    const arm = vi.fn(async () => ({ success: true }));
    const protocol = { arm } as unknown as SkillContext["protocol"];
    // Capture the policy the adapter passes to ctx.confirm.
    let seen: ConfirmPolicy | null = null;
    const confirm = vi.fn(async (policy: ConfirmPolicy) => {
      seen = policy;
      return true;
    });
    const ctx = makeCtx({ confirm });
    ctx.protocol = protocol;
    ctx.armState = "disarmed";

    await activate("arm", ctx);

    expect(confirm).toHaveBeenCalledTimes(1);
    // The confirm policy carries the danger variant + typed phrase.
    expect(seen).not.toBeNull();
    expect((seen as unknown as ConfirmPolicy).variant).toBe("danger");
    expect((seen as unknown as ConfirmPolicy).typedPhrase).toBe("ARM");
    expect(arm).toHaveBeenCalledTimes(1);
  });

  it("reports disabled with a no-link reason when no protocol is present", () => {
    const ctx = makeCtx({ protocol: null });
    const state = armSkill.getState(ctx);
    expect(state.kind).toBe("disabled");
    expect(state.reason).toBe("skills.reason.noFcLink");
  });

  it("reports disabled-already-armed when the vehicle is armed", () => {
    const protocol = { arm: vi.fn() } as unknown as SkillContext["protocol"];
    const ctx = makeCtx({ protocol, armState: "armed" });
    const state = armSkill.getState(ctx);
    expect(state.kind).toBe("disabled");
    expect(state.reason).toBe("skills.reason.alreadyArmed");
  });
});
