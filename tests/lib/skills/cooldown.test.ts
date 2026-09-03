/**
 * Tests for the dispatcher-owned cooldown + charge clocks and their projection
 * into the registry's per-drone state cache. Asserts: a one-shot with a real
 * cooldown shows a `cooldown` state with a 1->0 sweep, the window clears on its
 * own clock, a charge-bearing skill decrements + refuses at zero + recharges,
 * and the projection is HUD-honest (a failed activate consumes nothing, an
 * active toggle is never overridden to cooldown).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { activate } from "@/lib/skills";
import {
  getCooldownState,
  getChargeCount,
  resetCooldownState,
} from "@/lib/skills/cooldown";
import { useSkillRegistry } from "@/lib/skills/registry";
import { useDroneManager } from "@/stores/drone-manager";
import type { Skill, SkillContext, SkillState } from "@/lib/skills/types";

function clearRegistry(): void {
  useSkillRegistry.setState({
    skills: new Map(),
    states: new Map(),
    _order: new Map(),
    _seq: 0,
  });
}

function makeCtx(over: Partial<SkillContext> = {}): SkillContext {
  return {
    droneId: "drone-c",
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

function makeSkill(over: Partial<Skill> = {}): Skill {
  return {
    id: "cd",
    label: "skills.cd",
    icon: "Box",
    category: "flight",
    source: "builtin",
    toggle: false,
    getState: () => ({ kind: "idle" }) as SkillState,
    activate: vi.fn(async () => {}),
    ...over,
  };
}

describe("cooldown clock", () => {
  beforeEach(() => {
    clearRegistry();
    resetCooldownState();
    useDroneManager.setState({ selectedDroneId: "drone-c" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetCooldownState();
  });

  it("starts a real cooldown window after a successful one-shot activate", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const skill = makeSkill({ id: "cd-1", cooldownMs: 4000 });
    useSkillRegistry.getState().register(skill);

    await activate("cd-1", makeCtx({ droneId: "drone-c" }));

    // Immediately after activation the window is full: progress ~1, ~4s left.
    const state = getCooldownState("drone-c", "cd-1");
    expect(state).not.toBeNull();
    expect(state?.progress).toBeGreaterThan(0.9);
    expect(state?.remainingMs).toBe(4000);

    // Halfway: progress ~0.5.
    now.mockReturnValue(12_000);
    expect(getCooldownState("drone-c", "cd-1")?.progress).toBeCloseTo(0.5, 1);

    // Past the window: cleared.
    now.mockReturnValue(14_500);
    expect(getCooldownState("drone-c", "cd-1")).toBeNull();
  });

  it("projects a cooldown over an idle state but never over an active toggle", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(20_000);
    const oneShot = makeSkill({ id: "cd-2", cooldownMs: 3000 });
    // A toggle is always active and declares a cooldown; the projection must
    // not override active with cooldown (HUD-honesty).
    const toggle = makeSkill({
      id: "tg-2",
      toggle: true,
      cooldownMs: 3000,
      getState: () => ({ kind: "active" }),
    });
    const reg = useSkillRegistry.getState();
    reg.register(oneShot);
    reg.register(toggle);

    await activate("cd-2", makeCtx({ droneId: "drone-c" }));
    reg.recomputeSelected();

    const oneShotState = reg.getState("drone-c", "cd-2");
    expect(oneShotState.kind).toBe("cooldown");
    expect(typeof oneShotState.progress).toBe("number");

    // The toggle stays active even though it declares cooldownMs.
    expect(reg.getState("drone-c", "tg-2").kind).toBe("active");
    now.mockRestore();
  });

  it("does not start a cooldown when activate throws", async () => {
    vi.spyOn(Date, "now").mockReturnValue(30_000);
    const skill = makeSkill({
      id: "cd-3",
      cooldownMs: 5000,
      activate: vi.fn(async () => {
        throw new Error("protocol down");
      }),
    });
    useSkillRegistry.getState().register(skill);

    await activate("cd-3", makeCtx({ droneId: "drone-c" }));
    expect(getCooldownState("drone-c", "cd-3")).toBeNull();
  });
});

describe("charge budget", () => {
  beforeEach(() => {
    clearRegistry();
    resetCooldownState();
    useDroneManager.setState({ selectedDroneId: "drone-c" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    resetCooldownState();
  });

  it("decrements a charge per activation and refuses at zero", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    const activateFn = vi.fn(async () => {});
    const skill = makeSkill({
      id: "ch-1",
      activate: activateFn,
      charges: { current: 2, max: 2, rechargeMs: 60_000 },
    });
    useSkillRegistry.getState().register(skill);

    const notify = vi.fn();
    // Two activations succeed; the badge reflects the live count.
    await activate("ch-1", makeCtx({ droneId: "drone-c", notify }));
    expect(getChargeCount("drone-c", skill)?.current).toBe(1);

    // Advance past the debounce so the second one-shot is not swallowed.
    (Date.now as unknown as ReturnType<typeof vi.fn>).mockReturnValue(2_000);
    await activate("ch-1", makeCtx({ droneId: "drone-c", notify }));
    expect(getChargeCount("drone-c", skill)?.current).toBe(0);

    // Third refuses with a notify, activate not called again.
    (Date.now as unknown as ReturnType<typeof vi.fn>).mockReturnValue(3_000);
    await activate("ch-1", makeCtx({ droneId: "drone-c", notify }));
    expect(activateFn).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenCalledWith("skills.reason.noCharges", "warning");
  });

  it("recharges one charge per rechargeMs and surfaces it as the badge", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(0);
    const skill = makeSkill({
      id: "ch-2",
      charges: { current: 1, max: 2, rechargeMs: 10_000 },
    });
    const reg = useSkillRegistry.getState();
    reg.register(skill);

    // Spend the one charge.
    await activate("ch-2", makeCtx({ droneId: "drone-c" }));
    expect(getChargeCount("drone-c", skill)?.current).toBe(0);

    // Before the recharge interval: still zero.
    now.mockReturnValue(9_000);
    expect(getChargeCount("drone-c", skill)?.current).toBe(0);

    // After one interval: one charge back, and the projection badges it.
    now.mockReturnValue(10_500);
    expect(getChargeCount("drone-c", skill)?.current).toBe(1);
    reg.recomputeSelected();
    expect(reg.getState("drone-c", "ch-2").badge).toBe("1");
  });

  it("a skill without charges is always fireable and has no badge", async () => {
    vi.spyOn(Date, "now").mockReturnValue(0);
    const activateFn = vi.fn(async () => {});
    const skill = makeSkill({ id: "ch-3", activate: activateFn });
    const reg = useSkillRegistry.getState();
    reg.register(skill);

    await activate("ch-3", makeCtx({ droneId: "drone-c" }));
    expect(activateFn).toHaveBeenCalledTimes(1);
    expect(getChargeCount("drone-c", skill)).toBeNull();
    reg.recomputeSelected();
    expect(reg.getState("drone-c", "ch-3").badge).toBeUndefined();
  });
});
