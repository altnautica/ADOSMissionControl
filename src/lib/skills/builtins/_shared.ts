/**
 * Shared helpers for the built-in skills. Each built-in is a thin adapter over
 * an existing protocol call; these helpers express the common getState gates
 * (no FC link, wrong arm state, missing mode) and the i18n reason keys so the
 * 14 adapters stay short and consistent.
 *
 * @module skills/builtins/_shared
 * @license GPL-3.0-only
 */

import { specBuiltin, specConfirmGesture } from "@/lib/cockpit/spec-builtins";
import {
  PILOT_NO_ANSWER,
  requestPilotAction,
  sticksRouteToPilot,
  type PilotActionName,
} from "@/lib/input/pilot-stream";
import { PILOT_STALE_MS, useNavStreamStore } from "@/stores/nav-stream-store";
import type { CommandResult } from "@/lib/protocol/types";
import type {
  ConfirmGesture,
  ConfirmPolicy,
  SkillContext,
  SkillProtocol,
  SkillState,
} from "../types";

/**
 * The confirm policy of a built-in whose sheet text lives at
 * `skills.<key>.confirm.{title,message,button}`.
 */
export function builtinConfirm(
  key: string,
  gesture: ConfirmGesture,
  variant: ConfirmPolicy["variant"],
  extra?: Pick<ConfirmPolicy, "checklistAware" | "altitude">,
): ConfirmPolicy {
  return {
    title: `skills.${key}.confirm.title`,
    message: `skills.${key}.confirm.message`,
    confirmLabel: `skills.${key}.confirm.button`,
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
  return { ...builtinConfirm("modeChange", gesture, "primary"), values: { mode } };
}

/** i18n reason keys surfaced when a skill is disabled. */
export const REASON = {
  noFcLink: "skills.reason.noFcLink",
  alreadyArmed: "skills.reason.alreadyArmed",
  notArmed: "skills.reason.notArmed",
  alreadyDisarmed: "skills.reason.alreadyDisarmed",
  modeUnavailable: "skills.reason.modeUnavailable",
  noAutonomousNav: "skills.reason.noAutonomousNav",
  linkStale: "skills.reason.linkStale",
  linkStaleDisabled: "skills.reason.linkStaleDisabled",
  noPausedMission: "skills.reason.noPausedMission",
  noPilot: "skills.reason.noPilot",
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
 * cockpit spec names for it. Sheet text lives at `skills.<key>.confirm.*`.
 */
export function specConfirm(
  id: string,
  variant: ConfirmPolicy["variant"],
  extra?: Pick<ConfirmPolicy, "checklistAware" | "altitude">,
): ConfirmPolicy | undefined {
  const { gesture, holdMs } = specConfirmGesture(specBuiltin(id));
  if (gesture === "tap") return undefined;
  return { ...builtinConfirm(id, gesture, variant, extra), holdMs };
}

/**
 * True when the drone's pilot state arrived within the chip's staleness window
 * (`PILOT_STALE_MS`): the pilot is answering, not just reachable over an open
 * socket.
 */
export function pilotLive(droneId: string, now: number = Date.now()): boolean {
  const at = useNavStreamStore.getState().byDrone[droneId]?.pilot?.receivedAt;
  return at !== undefined && now - at <= PILOT_STALE_MS;
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
 * refusal (or no answer) reaches the dispatcher as a failure. When the pilot
 * gives no answer at all and `fallback` yields a flight-controller command,
 * that command's result is returned instead. */
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
  return { success: r.ok, resultCode: r.ok ? 0 : 4, message: r.ok ? "" : (r.err ?? "refused") };
}
