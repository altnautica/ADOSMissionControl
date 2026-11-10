/**
 * Shared helpers for the built-in skills. Each built-in is a thin adapter over
 * an existing protocol call; these helpers express the common getState gates
 * (no FC link, wrong arm state, missing mode), the reason keys (the spec's
 * `refusal.*`) and the confirm sheet text (spec keys) so the 14 adapters stay
 * short and consistent.
 *
 * @module skills/builtins/_shared
 * @license GPL-3.0-only
 */

import { specBuiltin, specConfirmGesture } from "@/lib/cockpit/spec-builtins";
import { refusalText } from "@/lib/hud/refusal";
import {
  PILOT_NO_ANSWER,
  requestPilotAction,
  sticksRouteToPilot,
  type PilotActionName,
} from "@/lib/input/pilot-stream";
import { pilotFresh } from "@/lib/hud/pilot-fresh";
import { useNavStreamStore } from "@/stores/nav-stream-store";
import type { CommandResult } from "@/lib/protocol/types";
import type {
  ConfirmGesture,
  ConfirmPolicy,
  SkillContext,
  SkillProtocol,
  SkillState,
} from "../types";

/** The spec key of each confirmed built-in's button label. */
const CONFIRM_BUTTON = {
  arm: "builtin.short.arm",
  disarm: "builtin.short.disarm",
  takeoff: "builtin.short.takeoff",
  land: "builtin.short.land",
  rth: "pilot.link_loss_action.rth",
  kill: "confirm.kill.button",
} as const;

/** A built-in that may ask for a confirm. */
export type ConfirmedBuiltin = keyof typeof CONFIRM_BUTTON;

/**
 * The confirm policy of a built-in, all spec text: the title and message are
 * the spec's `confirm.<key>.*`, the button its label for that built-in.
 */
export function builtinConfirm(
  key: ConfirmedBuiltin,
  gesture: ConfirmGesture,
  variant: ConfirmPolicy["variant"],
  extra?: Pick<ConfirmPolicy, "checklistAware" | "altitude">,
): ConfirmPolicy {
  return {
    title: `confirm.${key}.title`,
    message: `confirm.${key}.message`,
    confirmLabel: CONFIRM_BUTTON[key],
    variant,
    gesture,
    ...extra,
  };
}

/**
 * Hold-type recovery modes. Switching into one stops the vehicle where it is,
 * which is what an operator reaches for when something goes wrong, so the
 * press itself is the confirmation.
 */
const RECOVERY_MODES: Readonly<Record<string, true>> = {
  LOITER: true,
  BRAKE: true,
  ALT_HOLD: true,
  POSHOLD: true,
  QLOITER: true,
  QHOVER: true,
  FLOWHOLD: true,
};

/**
 * The confirm policy of a change into `mode`: none for a recovery mode, a
 * slide for AUTO (it starts the mission), a hold naming the mode otherwise.
 */
export function modeChangeConfirm(mode: string): ConfirmPolicy | undefined {
  if (RECOVERY_MODES[mode] === true) return undefined;
  const gesture: ConfirmGesture = mode === "AUTO" ? "slide" : "hold";
  return {
    title: "confirm.mode.title",
    message: "confirm.mode.to",
    confirmLabel: "confirm.mode.button",
    variant: "primary",
    gesture,
    values: { mode },
  };
}

/** Reason keys surfaced when a skill is disabled: the spec's `refusal.*`. */
export const REASON = {
  noFcLink: "refusal.no_fc_link",
  alreadyArmed: "refusal.already_armed",
  notArmed: "refusal.needs_armed",
  alreadyDisarmed: "refusal.already_disarmed",
  modeUnavailable: "refusal.mode_unavailable",
  linkStale: "refusal.link_stale",
  linkStaleDisabled: "refusal.link_stale_disabled",
  noPausedMission: "refusal.no_paused_mission",
  noPilot: "refusal.no_pilot",
} as const;

/** A drone has no live FC link when its protocol is absent. */
export function disabledIfNoLink(ctx: SkillContext): SkillState | null {
  if (!ctx.protocol) return { kind: "disabled", reason: REASON.noFcLink };
  return null;
}

/**
 * The link gate of a last-resort skill (kill, return home, land). A fresh link
 * passes; a stale link still passes when a transport is open, so the command
 * can be sent blind. Only a missing transport disables the skill.
 */
export function disabledIfNoBlindLink(ctx: SkillContext): SkillState | null {
  if (ctx.protocol || ctx.blindProtocol) return null;
  return { kind: "disabled", reason: REASON.noFcLink };
}

/** Mark a fireable last-resort state with the stale-link warning. */
export function withStaleLinkWarning(ctx: SkillContext, state: SkillState): SkillState {
  if (ctx.protocol || !ctx.blindProtocol || state.kind === "disabled") return state;
  return { ...state, warning: REASON.linkStale };
}

/** The path a last-resort command goes out on: the live link, else blind. */
export function lastResortPath(ctx: SkillContext): SkillProtocol | null {
  return ctx.protocol ?? ctx.blindProtocol ?? null;
}

/**
 * Disabled unless the vehicle is positively known to be disarmed: an armed
 * vehicle is already armed, and an unknown arm state means no heartbeat is
 * being read, so arming blind is refused as a missing link.
 */
export function disabledUnlessDisarmed(ctx: SkillContext): SkillState | null {
  if (ctx.armState === "armed") return { kind: "disabled", reason: REASON.alreadyArmed };
  if (ctx.armState === "unknown") return { kind: "disabled", reason: REASON.noFcLink };
  return null;
}

/**
 * The confirm policy of a built-in, with the tier and hold time the shared
 * cockpit spec names for it. Sheet text as in `builtinConfirm`.
 */
export function specConfirm(
  id: ConfirmedBuiltin,
  variant: ConfirmPolicy["variant"],
  extra?: Pick<ConfirmPolicy, "checklistAware" | "altitude">,
): ConfirmPolicy | undefined {
  const { gesture, holdMs } = specConfirmGesture(specBuiltin(id));
  if (gesture === "tap") return undefined;
  return { ...builtinConfirm(id, gesture, variant, extra), holdMs };
}

/**
 * True when the drone's pilot state is fresh (`pilotFresh`, the age at which
 * the chip turns to LINK): the pilot is answering, not just reachable over an
 * open socket.
 */
export function pilotLive(droneId: string, now: number = Date.now()): boolean {
  return pilotFresh(useNavStreamStore.getState().byDrone[droneId]?.pilot?.receivedAt, now);
}

/**
 * True when this drone is flown by its ADOS pilot from this surface: an open
 * pilot stream, `control.mode == ados`, and a live pilot. Built-ins then send
 * pilot actions instead of raw flight-controller commands. A stalled pilot
 * (open socket, no fresh state) loses the route to the flight controller
 * whenever a flight-controller path exists, so stop, kill and return home
 * never wait on a pilot that stopped answering.
 */
export function viaPilot(ctx: SkillContext): boolean {
  if (!sticksRouteToPilot(ctx.droneId)) return false;
  return pilotLive(ctx.droneId) || lastResortPath(ctx) === null;
}

/** Send a built-in as a pilot action and wait for the pilot's answer, so a
 * refusal (or no answer) reaches the dispatcher as a failure whose message is
 * the spec's text for the refusal code (`refusal.*`, `not_ready:<id>` naming
 * the readiness item, an unknown code shown as sent). When the pilot gives no
 * answer at all and `fallback` yields a flight-controller command, that
 * command's result is returned instead. */
export async function pilotActionResult(
  name: PilotActionName,
  args?: Record<string, unknown>,
  fallback?: () => Promise<CommandResult> | undefined,
): Promise<CommandResult> {
  const r = await requestPilotAction(name, args);
  if (!r.ok && r.err === PILOT_NO_ANSWER && fallback) {
    const fb = fallback();
    if (fb) return fb;
  }
  return { success: r.ok, resultCode: r.ok ? 0 : 4, message: r.ok ? "" : refusalText(r.err) };
}
