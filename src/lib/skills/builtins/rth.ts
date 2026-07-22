/**
 * Return-to-Home skill — commands the vehicle to return to its launch point.
 * One-shot, any arm state, primary confirm (RTL phrase). Requires autonomous
 * nav.
 *
 * @module skills/builtins/rth
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink } from "./_shared";

export const rthSkill: Skill = {
  id: "rth",
  label: "skills.rth",
  icon: "Home",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  requiresAutonomousNav: true,
  // A short real lockout after a return-to-home command so a stray second press
  // cannot re-issue the same high-consequence command; the slot sweeps the
  // window down so the operator sees when it is fireable again.
  cooldownMs: 5000,
  confirm: {
    title: "skills.rth.confirm.title",
    message: "skills.rth.confirm.message",
    confirmLabel: "skills.rth.confirm.button",
    variant: "primary",
    typedPhrase: "RTL",
  },
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and neither spends the cooldown nor greys the control on it.
  activate: async (ctx) => ctx.protocol?.returnToLaunch(),
};
