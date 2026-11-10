/**
 * Return-to-Home skill — commands the vehicle to return to its launch point.
 * One-shot, any arm state, hold-to-confirm. Requires autonomous nav. A
 * last-resort command: on a stale link it stays fireable and is sent blind,
 * with a stale-link warning.
 *
 * @module skills/builtins/rth
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { noteModeOnSuccess } from "../flight-facts";
import { disabledIfNoLink, pilotActionResult, REASON, specConfirm, viaPilot } from "./_shared";

export const rthSkill: Skill = {
  id: "rth",
  label: "skills.rth",
  icon: "Home",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  // A short real lockout after a return-to-home command so a stray second press
  // cannot re-issue the same high-consequence command; the slot sweeps the
  // window down so the operator sees when it is fireable again.
  cooldownMs: 5000,
  confirm: specConfirm("rth", "primary"),
  // The shared spec disables Return home on a stale link, with the reason.
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return ctx.linkStale ? { kind: "disabled", reason: REASON.linkStaleDisabled } : noLink;
    if (ctx.armState === "disarmed") return { kind: "disabled", reason: REASON.notArmed };
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and neither spends the cooldown nor greys the control on it.
  // A pilot that gives no answer at all hands the return to the flight
  // controller.
  activate: async (ctx) =>
    // An operator return the drone accepted is not a failsafe (Pause stays
    // available in it while it lasts).
    noteModeOnSuccess(
      ctx.droneId,
      "RTL",
      viaPilot(ctx)
        ? pilotActionResult("rth", undefined, () => ctx.protocol?.returnToLaunch())
        : ctx.protocol?.returnToLaunch(),
    ),
};
