/**
 * The skill module surface: the single gating pipeline (`activate`/
 * `deactivate`), the per-drone context builder, the built-in registration, and
 * the subscription wiring that keeps the selected drone's state cache fresh.
 * The keyboard/gamepad dispatcher, the Skill Bar, and the action panel all
 * funnel presses through `activate` so confirm, arm-gating, and idempotency
 * live in one place.
 *
 * @module skills
 * @license GPL-3.0-only
 */

import type { Skill, SkillContext, SkillActivateArgs } from "./types";
import {
  useSkillRegistry,
  buildSkillContextFor,
  setSkillNotifier,
} from "./registry";
import { builtinSkills } from "./builtins";
import {
  hasCharge,
  spendCharge,
  startCooldown,
  setCooldownTick,
} from "./cooldown";
import { useDroneStore } from "@/stores/drone-store";
import { useFollowMeStore } from "@/stores/follow-me-store";

export type { SkillCharges } from "./types";
export {
  getCooldownState,
  getChargeCount,
  resetCooldownState,
} from "./cooldown";

export type {
  Skill,
  SkillState,
  SkillContext,
  SkillActivateArgs,
  ConfirmPolicy,
  SkillCategory,
  SkillSource,
  ArmRequirement,
  SkillProtocol,
} from "./types";
export { useSkillRegistry, setSkillNotifier, notifySkill } from "./registry";
export {
  buildSkillContextForNode,
  availableModesForNode,
  firmwareTypeForNode,
} from "./node-context";
export type {
  SkillTargetNode,
  NodeSkillContextOptions,
} from "./node-context";

/**
 * Build the per-drone SkillContext the dispatcher hands to a skill. Re-exported
 * from the registry so callers have one import for the whole surface.
 */
export function buildSkillContext(droneId: string): SkillContext {
  return buildSkillContextFor(droneId);
}

/** Default one-shot debounce window (ms) — swallows a stuttered double-press. */
const DEBOUNCE_MS = 750;

/**
 * Per-(droneId, skillId) dispatch guards. `busy` blocks re-entrant presses
 * while an activate/deactivate promise is in flight or a confirm dialog is
 * open; `cooldownUntil` swallows a repeat one-shot inside the debounce window.
 */
const busy = new Set<string>();
const cooldownUntil = new Map<string, number>();

function guardKey(droneId: string, skillId: string): string {
  return `${droneId}::${skillId}`;
}

/**
 * The single gating pipeline used by keyboard, gamepad, the Skill Bar, and the
 * action panel. Enforces, in order: drone/skill presence → busy/re-entrancy →
 * disabled gate (toast, no dialog) → toggle-off short-circuit → arm-requirement
 * → confirm → idempotency debounce → activate. Always recomputes the selected
 * drone's state when it finishes so the bar reflects the new truth.
 */
export async function activate(
  skillId: string,
  ctx: SkillContext,
  args?: SkillActivateArgs,
): Promise<void> {
  if (!ctx.droneId) return;

  const registry = useSkillRegistry.getState();
  const skill = registry.skills.get(skillId);
  if (!skill) return;

  const key = guardKey(ctx.droneId, skillId);

  // Re-entrancy / busy guard — an in-flight activation or open confirm drops
  // further presses for this (drone, skill).
  if (busy.has(key)) return;

  // Disabled gate: surface the reason, never open a dialog.
  const state = skill.getState(ctx);
  if (state.kind === "disabled") {
    if (state.reason) ctx.notify(state.reason, "warning");
    return;
  }

  // Toggle-off short-circuit: pressing an active toggle stops it.
  if (skill.toggle && state.kind === "active") {
    await deactivate(skillId, ctx);
    return;
  }

  // Arm-requirement gate — explicit second check so activate never runs in the
  // wrong arm state even if getState was momentarily stale.
  const armReq = skill.armRequirement ?? "any";
  if (armReq === "armed" && ctx.armState !== "armed") {
    ctx.notify("skills.reason.notArmed", "warning");
    return;
  }
  if (armReq === "disarmed" && ctx.armState !== "disarmed") {
    ctx.notify("skills.reason.alreadyArmed", "warning");
    return;
  }

  // Charge gate — a one-shot skill with a charge budget refuses when empty,
  // before any confirm dialog opens. Toggles never consume charges.
  if (!skill.toggle && !hasCharge(ctx.droneId, skill)) {
    ctx.notify("skills.reason.noCharges", "warning");
    return;
  }

  // Confirm gate — open the shared dialog and await the operator.
  if (skill.confirm) {
    busy.add(key);
    let confirmed = false;
    try {
      confirmed = await ctx.confirm(skill.confirm);
    } finally {
      busy.delete(key);
    }
    if (!confirmed) return;
  }

  // Idempotency: swallow a repeat one-shot inside the debounce window. Toggles
  // self-guard via the toggle-off path, so the debounce applies to one-shots.
  if (!skill.toggle) {
    const now = Date.now();
    const until = cooldownUntil.get(key) ?? 0;
    if (now < until) return;
    cooldownUntil.set(key, now + DEBOUNCE_MS);
  }

  busy.add(key);
  try {
    const result = await skill.activate(ctx, args);
    // A returned result with success=false is the vehicle's (or its lane's)
    // own refusal. Silence here reads as success on a surface with no other
    // feedback, so the answer is surfaced in the operator's face.
    const rejected = result != null && result.success === false;
    if (rejected) {
      ctx.notify(
        typeof result.message === "string" && result.message.trim() !== ""
          ? result.message
          : "skills.reason.commandRejected",
        "error",
      );
    }
    // Only an accepted one-shot consumes a charge and arms the cooldown — a
    // rejected result (above) and a thrown protocol call (the catch below) do
    // neither, so the badge and the sweep never assert work that did not
    // happen.
    if (!skill.toggle && !rejected) {
      spendCharge(ctx.droneId, skill);
      startCooldown(ctx.droneId, skill);
    }
  } catch {
    // A failed protocol call must not wedge the dispatcher; the next press is
    // allowed once the debounce elapses.
  } finally {
    busy.delete(key);
    useSkillRegistry.getState().recomputeSelected();
  }
}

/** Stop a toggle behavior. Busy-guarded and protocol-optional via the skill. */
export async function deactivate(
  skillId: string,
  ctx: SkillContext,
): Promise<void> {
  const registry = useSkillRegistry.getState();
  const skill = registry.skills.get(skillId);
  if (!skill || !skill.deactivate) return;

  const key = guardKey(ctx.droneId, skillId);
  if (busy.has(key)) return;

  busy.add(key);
  try {
    await skill.deactivate(ctx);
  } catch {
    // Teardown is best-effort; the behavior's own store reconciles the truth.
  } finally {
    busy.delete(key);
    useSkillRegistry.getState().recomputeSelected();
  }
}

let builtinsRegistered = false;

/**
 * Register the 14 built-in skills. Idempotent — safe under React strict-mode
 * double-invoke and repeated mounts.
 */
export function registerBuiltins(): void {
  if (builtinsRegistered) return;
  builtinsRegistered = true;
  const register = useSkillRegistry.getState().register;
  for (const skill of builtinSkills) {
    register(skill);
  }
}

let subscriptionsInitialised = false;

/**
 * Subscribe the stores that drive skill state (arm/mode/selected-drone, the
 * Follow-Me behavior store) and recompute the selected drone's state on any
 * change, debounced to animation-frame cadence so a 10 Hz telemetry stream
 * does not thrash the bar. Idempotent; app-lifetime singletons, no teardown.
 */
export function initSkillSubscriptions(): void {
  if (subscriptionsInitialised) return;
  subscriptionsInitialised = true;

  let frame: number | null = null;
  const schedule = () => {
    if (frame !== null) return;
    const run = () => {
      frame = null;
      useSkillRegistry.getState().recomputeSelected();
    };
    if (typeof requestAnimationFrame === "function") {
      frame = requestAnimationFrame(run);
    } else {
      // Non-browser/test environment: recompute synchronously.
      run();
    }
  };

  // The cooldown/charge clock recomputes the bar at each sweep frame + recharge
  // boundary so the conic sweep animates and the charge badge updates live.
  setCooldownTick(schedule);

  useDroneStore.subscribe((next, prev) => {
    if (
      next.armState !== prev.armState ||
      next.flightMode !== prev.flightMode ||
      next.previousMode !== prev.previousMode ||
      next.selectedId !== prev.selectedId ||
      next.connectionState !== prev.connectionState
    ) {
      schedule();
    }
  });

  useFollowMeStore.subscribe((next, prev) => {
    if (next.isActive !== prev.isActive || next.isPaused !== prev.isPaused) {
      schedule();
    }
  });
}
