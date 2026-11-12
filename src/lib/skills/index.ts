/**
 * The skill module surface: the single gating pipeline (`activate`/
 * `deactivate`), the per-drone context builder, the built-in registration, and
 * (from `./subscriptions`) the wiring that keeps the selected drone's state cache fresh.
 * The keyboard/gamepad dispatcher, the Skill Bar, and the action panel all
 * funnel presses through `activate` so confirm, arm-gating, and idempotency
 * live in one place.
 *
 * @module skills
 * @license GPL-3.0-only
 */

import type {
  Skill,
  SkillContext,
  SkillActivateArgs,
  ConfirmResult,
} from "./types";
import {
  useSkillRegistry,
  buildSkillContextFor,
  setSkillNotifier,
} from "./registry";
import { builtinSkills } from "./builtins";
import { lastResortPath, viaPilot } from "./builtins/_shared";
import { SPEC_BUILTINS } from "@/lib/cockpit/spec-builtins";
import {
  hasCharge,
  spendCharge,
  startCooldown,
} from "./cooldown";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useSkillConfirmStore } from "@/stores/skill-confirm-store";
import { resolveBoundSkillId } from "./bound-skill";
import { useChecklistStore } from "@/stores/checklist-store";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { stopFollowMe } from "@/lib/follow-me";

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
  ConfirmGesture,
  ConfirmResult,
  ConfirmChoice,
  ConfirmAltitude,
  SkillCategory,
  SkillSource,
  ArmRequirement,
  SkillProtocol,
} from "./types";
export {
  CONFIRM_HOLD_DEFAULT_MS,
  GUARD_WINDOW_MS,
  SPEC_HOLD_MS,
  confirmHoldMs,
} from "./types";
export {
  useSkillRegistry,
  setSkillNotifier,
  notifySkill,
  SKILL_LINK_FRESH_MS,
} from "./registry";
export { resolveBoundSkillId, isMissionPaused } from "./bound-skill";
export type { BoundSkillContext } from "./bound-skill";
export {
  buildSkillContextForNode,
  availableModesForNode,
  firmwareTypeForNode,
} from "./node-context";
export type {
  SkillTargetNode,
  NodeSkillContextOptions,
} from "./node-context";
export { initSkillSubscriptions } from "./subscriptions";

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
 * `padAccept` accepts the confirm a guarded skill has open, for a completed
 * pad hold that arrives while it shows.
 */
const busy = new Set<string>();
const cooldownUntil = new Map<string, number>();
const padAccept = new Map<string, () => void>();

function guardKey(droneId: string, skillId: string): string {
  return `${droneId}::${skillId}`;
}

/** Accept the confirm open for `key`: the shared sheet, when it shows the
 *  guarded confirm for this drone, closes as confirmed. */
function acceptOpenConfirm(key: string, droneId: string): void {
  const accept = padAccept.get(key);
  if (!accept) return;
  const confirms = useSkillConfirmStore.getState();
  if (confirms.pending?.droneId === droneId && confirms.pending.policy.gesture === "guarded") {
    confirms.resolvePending(true);
  }
  accept();
}

/** A built-in the shared spec sends blind on a stale link (pause). */
function sendsBlind(skill: Skill): boolean {
  return (
    skill.source === "builtin" &&
    SPEC_BUILTINS.some((b) => b.id === skill.id && b.stale_link === "send_blind")
  );
}

/** True when an unknown arm state still lets `skill` go out: it is sent blind
 *  and a route to the vehicle remains. */
function blindThroughUnknown(skill: Skill, ctx: SkillContext): boolean {
  return (
    ctx.armState === "unknown" &&
    sendsBlind(skill) &&
    (lastResortPath(ctx) !== null || viaPilot(ctx))
  );
}

/**
 * Skills that take the vehicle somewhere else or change what it is doing. A
 * follow-me session on the same drone streams repositions, so it ends before
 * one of these runs rather than fighting it. Every `mode.*` skill is a mode
 * change too.
 */
const PREEMPTS_FOLLOW_ME: Record<string, true> = {
  rth: true, land: true, kill: true, "set-mode": true, pause: true,
};

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
  const policy = skill.confirmFor ? skill.confirmFor(args, ctx) : skill.confirm;
  // A `hold` policy fired by a controller hold binding (`confirmedByHold`) is
  // confirmed by that hold; a `guarded` policy (the emergency stop) counts the
  // pad hold once it ran at least the policy's own hold. An incomplete
  // pre-flight checklist always opens the sheet, so the operator sees what is
  // failing before an arm.
  const heldOnPad =
    policy !== undefined &&
    args?.confirmedByHold === true &&
    (policy.gesture === "hold" ||
      (policy.gesture === "guarded" && (args.heldMs ?? 0) >= (policy.holdMs ?? Infinity))) &&
    !(policy.checklistAware && !useChecklistStore.getState().isReadyToArm(ctx.droneId));

  // Re-entrancy / busy guard — an in-flight activation or open confirm drops
  // further presses for this (drone, skill). The one exception is a completed
  // pad hold of the emergency stop: it is the operator's confirmation, so it
  // accepts the stop sheet already open for this (drone, skill), whose
  // pipeline then sends the stop once.
  if (busy.has(key)) {
    if (heldOnPad && policy?.gesture === "guarded") acceptOpenConfirm(key, ctx.droneId);
    return;
  }

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
  // wrong arm state even if getState was momentarily stale. An unknown arm
  // state (no heartbeat to read it from) satisfies neither requirement, and is
  // reported as the missing link it is rather than as armed or disarmed.
  // The exception is a built-in the shared spec sends blind on a stale link
  // (pause): link loss leaves the arm state unknown, and its brake must still
  // go out on whatever route remains.
  const armReq = skill.armRequirement ?? "any";
  if (armReq !== "any" && ctx.armState !== armReq && !blindThroughUnknown(skill, ctx)) {
    ctx.notify(
      ctx.armState === "unknown"
        ? "refusal.no_fc_link"
        : armReq === "armed"
          ? "refusal.needs_armed"
          : "refusal.already_armed",
      "warning",
    );
    return;
  }

  // Charge gate — a one-shot skill with a charge budget refuses when empty,
  // before any confirm dialog opens. Toggles never consume charges.
  if (!skill.toggle && !hasCharge(ctx.droneId, skill)) {
    ctx.notify("refusal.no_charges", "warning");
    return;
  }

  // Confirm gate — open the shared sheet and await the operator. A `tap`
  // policy is confirmed by the press itself and opens nothing; so is a policy
  // the pad hold above confirmed (`heldOnPad`). The sheet names the target
  // drone and, on a stale link, warns the command may not arrive.
  let activateArgs = args;
  let sendCtx = ctx;
  if (policy && policy.gesture !== "tap" && !heldOnPad) {
    busy.add(key);
    let result: ConfirmResult = false;
    try {
      const altitude =
        policy.altitude && typeof args?.altitudeM === "number"
          ? { ...policy.altitude, defaultM: args.altitudeM }
          : policy.altitude;
      const padAccepted = Promise.withResolvers<ConfirmResult>();
      padAccept.set(key, () => padAccepted.resolve(true));
      result = await Promise.race([
        ctx.confirm({
          ...policy,
          ...(altitude ? { altitude } : {}),
          values: {
            ...policy.values,
            ...(skill.confirmValues ? skill.confirmValues(args) : {}),
            drone: skillTargetName(ctx.droneId),
          },
          ...(ctx.linkStale && !ctx.protocol ? { staleLink: true } : {}),
          ...(typeof args?.gamepadButton === "number"
            ? { gamepadButton: args.gamepadButton }
            : {}),
        }),
        padAccepted.promise,
      ]);
    } finally {
      busy.delete(key);
      padAccept.delete(key);
    }
    if (!result) return;
    if (typeof result === "object" && typeof result.altitudeM === "number") {
      activateArgs = { ...args, altitudeM: result.altitudeM };
    }
    // The sheet can stay open for seconds (a guarded hold runs 4.5 s), so the
    // vehicle is re-read before anything is sent: a changed arm state, a skill
    // that became unavailable or an unmet arm requirement cancels the send.
    // Every store-built context carries `refresh`; a hand-built one (a test or
    // an external caller) has no live source to re-read and is sent as is.
    if (ctx.refresh) {
      sendCtx = { ...ctx.refresh(), notify: ctx.notify, confirm: ctx.confirm };
      if (changedSincePrompt(skill, ctx, sendCtx)) {
        ctx.notify("refusal.changed_since_prompt", "warning");
        return;
      }
    }
  }

  // Idempotency: swallow a repeat one-shot inside the debounce window. Toggles
  // self-guard via the toggle-off path, so the debounce applies to one-shots.
  if (!skill.toggle) {
    const now = Date.now();
    const until = cooldownUntil.get(key) ?? 0;
    if (now < until) return;
    cooldownUntil.set(key, now + DEBOUNCE_MS);
  }

  if (PREEMPTS_FOLLOW_ME[skillId] === true || skillId.startsWith("mode.")) {
    if (useFollowMeStore.getState().droneId === ctx.droneId) stopFollowMe();
    void stopMotionSkills(ctx);
  } else if (skill.motion && useFollowMeStore.getState().droneId === ctx.droneId) {
    // An extension's motion skill and the GCS-position follow both steer the
    // drone; one at a time, so the follow ends before the skill starts.
    stopFollowMe();
  }

  busy.add(key);
  try {
    const result = await skill.activate(sendCtx, activateArgs);
    // A returned result with success=false is the vehicle's (or its lane's)
    // own refusal. Silence here reads as success on a surface with no other
    // feedback, so the answer is surfaced in the operator's face.
    const rejected = result != null && result.success === false;
    if (rejected) {
      ctx.notify(
        typeof result.message === "string" && result.message.trim() !== ""
          ? result.message
          : "refusal.command_rejected",
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

/**
 * Fire the skill a binding names, after resolving it against the live vehicle
 * state: an `arm` binding disarms an armed vehicle and a `pause` binding
 * resumes a paused mission. Every bound surface (keys, gamepad, Skill Bar,
 * palette, radial) dispatches through here.
 */
export function activateBound(
  skillId: string,
  ctx: SkillContext,
  args?: SkillActivateArgs,
): Promise<void> {
  return activate(resolveBoundSkillId(skillId, ctx.armState, ctx), ctx, args);
}

/** The name a confirm sheet shows for the drone a skill targets. */
function skillTargetName(droneId: string): string {
  const managed = useDroneManager.getState().drones.get(droneId);
  if (managed?.name) return managed.name;
  return useNodeRegistryStore.getState().getEntry(droneId)?.presence?.name ?? droneId;
}

/**
 * True when the vehicle moved under an open confirm sheet so the approved
 * command no longer means what the operator approved: the arm state changed,
 * the skill became unavailable, or its arm requirement is no longer met.
 *
 * A stop or brake (no arm requirement, or sent blind on a stale link: kill,
 * pause) means the same thing whatever the arm state: link loss turning
 * `armed` into `unknown` under the hold, or its return, never cancels it, and
 * an unknown arm state with a route left still meets its requirement.
 */
function changedSincePrompt(
  skill: Skill,
  before: SkillContext,
  after: SkillContext,
): boolean {
  const armReq = skill.armRequirement ?? "any";
  const holdsThroughArmChange = armReq === "any" || sendsBlind(skill);
  if (!holdsThroughArmChange && after.armState !== before.armState) return true;
  if (skill.getState(after).kind === "disabled") return true;
  return armReq !== "any" && after.armState !== armReq && !blindThroughUnknown(skill, after);
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

/**
 * Stop every active `motion` skill on the context's drone. Built-in pause,
 * land, rth, kill and Mode-sheet changes call this; navigation estimators and
 * camera skills are not motion skills and keep running.
 */
export async function stopMotionSkills(ctx: SkillContext): Promise<void> {
  const registry = useSkillRegistry.getState();
  const active = [...registry.skills.values()].filter(
    (s) => s.motion === true && registry.getState(ctx.droneId, s.id).kind === "active",
  );
  await Promise.all(active.map((s) => deactivate(s.id, ctx)));
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
