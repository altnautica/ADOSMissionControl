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
  isSkillLinkFresh,
} from "./registry";
import { builtinSkills } from "./builtins";
import {
  hasCharge,
  spendCharge,
  startCooldown,
  setCooldownTick,
} from "./cooldown";
import { useDroneStore } from "@/stores/drone-store";
import { useDroneManager } from "@/stores/drone-manager";
import { useNodeRegistryStore } from "@/stores/node-registry";
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

/**
 * Build the per-drone SkillContext the dispatcher hands to a skill. Re-exported
 * from the registry so callers have one import for the whole surface.
 */
export function buildSkillContext(droneId: string): SkillContext {
  return buildSkillContextFor(droneId);
}

/** Default one-shot debounce window (ms) — swallows a stuttered double-press. */
const DEBOUNCE_MS = 750;

/** How often the FC heartbeat age is sampled for link freshness (ms). */
const LINK_FRESH_POLL_MS = 500;

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
 * Skills that take the vehicle somewhere else or change what it is doing. A
 * follow-me session on the same drone streams repositions, so it ends before
 * one of these runs rather than fighting it. Every `mode.*` skill is a mode
 * change too.
 */
const PREEMPTS_FOLLOW_ME: Record<string, true> = {
  rth: true, land: true, abort: true, kill: true, "set-mode": true, pause: true,
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
  // wrong arm state even if getState was momentarily stale. An unknown arm
  // state (no heartbeat to read it from) satisfies neither requirement, and is
  // reported as the missing link it is rather than as armed or disarmed.
  const armReq = skill.armRequirement ?? "any";
  if (armReq !== "any" && ctx.armState !== armReq) {
    ctx.notify(
      ctx.armState === "unknown"
        ? "skills.reason.noFcLink"
        : armReq === "armed"
          ? "skills.reason.notArmed"
          : "skills.reason.alreadyArmed",
      "warning",
    );
    return;
  }

  // Charge gate — a one-shot skill with a charge budget refuses when empty,
  // before any confirm dialog opens. Toggles never consume charges.
  if (!skill.toggle && !hasCharge(ctx.droneId, skill)) {
    ctx.notify("skills.reason.noCharges", "warning");
    return;
  }

  // Confirm gate — open the shared sheet and await the operator. A `tap`
  // policy is confirmed by the press itself and opens nothing; so is a `hold`
  // policy fired by a controller hold binding (`confirmedByHold`), whose own
  // hold time is the confirmation. The sheet names the target drone and, on a
  // stale link, warns the command may not arrive.
  let activateArgs = args;
  let sendCtx = ctx;
  const policy = skill.confirmFor ? skill.confirmFor(args, ctx) : skill.confirm;
  // An incomplete pre-flight checklist always opens the sheet, so the
  // operator sees what is failing before an arm.
  const heldOnPad =
    policy?.gesture === "hold" &&
    args?.confirmedByHold === true &&
    !(policy.checklistAware && !useChecklistStore.getState().isReadyToArm(ctx.droneId));
  if (policy && policy.gesture !== "tap" && !heldOnPad) {
    busy.add(key);
    let result: ConfirmResult = false;
    try {
      const altitude =
        policy.altitude && typeof args?.altitudeM === "number"
          ? { ...policy.altitude, defaultM: args.altitudeM }
          : policy.altitude;
      result = await ctx.confirm({
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
      });
    } finally {
      busy.delete(key);
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
        ctx.notify("skills.reason.changedSincePrompt", "warning");
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
 */
function changedSincePrompt(
  skill: Skill,
  before: SkillContext,
  after: SkillContext,
): boolean {
  if (after.armState !== before.armState) return true;
  if (skill.getState(after).kind === "disabled") return true;
  const armReq = skill.armRequirement ?? "any";
  return armReq !== "any" && after.armState !== armReq;
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

let subscriptionsInitialised = false;

/**
 * Subscribe the stores that drive skill state (arm/mode/connection, the
 * selected drone, FC link freshness, checklist readiness, the Follow-Me
 * behavior store, cooldown ends) and recompute the selected drone's state on
 * any change, coalesced to animation-frame cadence so a 10 Hz telemetry stream
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

  // The cooldown/charge clock recomputes the bar once at each window end and
  // recharge boundary; the sweep in between animates in CSS.
  setCooldownTick(schedule);

  // Link freshness. A heartbeat that stops arriving changes no store field, so
  // without a clock the bar would keep offering commands over a dead link. The
  // ticker samples the selected drone's heartbeat age and recomputes only when
  // freshness (or the selection it was sampled for) flips.
  let linkDroneId: string | null = null;
  let linkFresh: boolean | null = null;
  setInterval(() => {
    const droneId = useDroneManager.getState().selectedDroneId;
    const fresh = isSkillLinkFresh(
      useDroneStore.getState().lastHeartbeat,
      Date.now(),
    );
    if (droneId === linkDroneId && fresh === linkFresh) return;
    linkDroneId = droneId;
    linkFresh = fresh;
    schedule();
  }, LINK_FRESH_POLL_MS);

  // Checklist readiness gates arm/take-off; recompute when it flips for the
  // selected drone.
  let checklistReady: boolean | null = null;
  useChecklistStore.subscribe((state) => {
    const droneId = useDroneManager.getState().selectedDroneId;
    const ready = droneId ? state.isReadyToArm(droneId) : false;
    if (ready === checklistReady) return;
    checklistReady = ready;
    schedule();
  });

  useDroneStore.subscribe((next, prev) => {
    if (
      next.armState !== prev.armState ||
      next.flightMode !== prev.flightMode ||
      next.connectionState !== prev.connectionState
    ) {
      schedule();
    }
  });

  // Selection lives in the drone manager, so it needs its own subscription
  // rather than riding the flight-state store.
  useDroneManager.subscribe((next, prev) => {
    if (next.selectedDroneId !== prev.selectedDroneId) {
      schedule();
    }
  });

  useFollowMeStore.subscribe((next, prev) => {
    if (next.isActive !== prev.isActive || next.isPaused !== prev.isPaused) {
      schedule();
    }
  });
}
