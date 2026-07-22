/**
 * Kill skill — emergency motor cut. One-shot, any arm state. The highest-
 * consequence built-in: a two-stage confirm with a 3-second countdown before
 * the KILL typed-phrase enables. No arm requirement (kill must work anytime).
 *
 * @module skills/builtins/kill
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { disabledIfNoLink } from "./_shared";

export const killSkill: Skill = {
  id: "kill",
  label: "skills.kill",
  icon: "Skull",
  category: "safety",
  source: "builtin",
  toggle: false,
  armRequirement: "any",
  confirm: {
    title: "skills.kill.confirm.title",
    message: "skills.kill.confirm.message",
    confirmLabel: "skills.kill.confirm.button",
    variant: "danger",
    typedPhrase: "KILL",
    twoStageCountdownSeconds: 3,
  },
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    return { kind: "idle" };
  },
  // The vehicle's answer goes back to the dispatcher, which surfaces a
  // refusal and spends nothing on it.
  activate: async (ctx) => ctx.protocol?.killSwitch(),
};
