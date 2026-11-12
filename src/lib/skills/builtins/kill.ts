/**
 * Kill skill — emergency motor cut. One-shot, any arm state. The highest-
 * consequence built-in: the guarded tier — the first activation arms a guard
 * and only a hold inside the guard window fires. No arm requirement (kill
 * must work anytime). A last-resort command: on a stale link it stays
 * fireable and is sent blind, with a stale-link warning.
 *
 * @module skills/builtins/kill
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import {
  disabledIfNoBlindLink,
  pilotActionResult,
  specConfirm,
  viaPilot,
  lastResortPath,
  withStaleLinkWarning,
} from "./_shared";

export const killSkill: Skill = {
  id: "kill",
  label: "skills.kill",
  icon: "Skull",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  confirm: specConfirm("kill", "danger"),
  getState: (ctx) => {
    const noLink = disabledIfNoBlindLink(ctx);
    if (noLink) return noLink;
    return withStaleLinkWarning(ctx, { kind: "idle" });
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  // `true` is the confirm block above: the dispatcher only reaches activate
  // after the guard was armed and the hold inside its window completed.
  // A pilot that gives no answer at all hands the cut to the flight controller.
  activate: async (ctx) =>
    viaPilot(ctx)
      ? pilotActionResult("kill", undefined, () => lastResortPath(ctx)?.killSwitch(true))
      : lastResortPath(ctx)?.killSwitch(true),
};
