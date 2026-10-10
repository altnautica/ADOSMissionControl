/**
 * @module skills/batch-confirm
 * @description The confirmation a multi-node dispatch asks for. A single
 * vehicle confirms with a gesture on its sheet; applying the same command to
 * many nodes at once is not a reason to ask for less, so a fleet or swarm
 * dispatch of any skill that confirms at all asks the operator to type the
 * skill's id.
 * @license GPL-3.0-only
 */

import type { ConfirmPolicy, Skill } from "./types";

/**
 * The policy a skill confirms with when dispatched without arguments: its
 * argument-dependent policy when it has one (mode presets), else its fixed
 * policy. Undefined when it does not confirm.
 */
export function batchConfirmPolicy(skill: Skill): ConfirmPolicy | undefined {
  return skill.confirmFor ? skill.confirmFor() : skill.confirm;
}

/** The phrase to type, or undefined when the skill does not confirm. */
export function batchConfirmPhrase(skill: Skill): string | undefined {
  const policy = batchConfirmPolicy(skill);
  if (!policy || policy.gesture === "tap") return undefined;
  return skill.id.toUpperCase();
}
