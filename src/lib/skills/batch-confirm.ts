/**
 * @module skills/batch-confirm
 * @description The typed phrase a multi-node dispatch asks for. A single
 * vehicle confirms with a gesture on its sheet; applying the same command to
 * many nodes at once is not a reason to ask for less, so a fleet or swarm
 * dispatch of any skill that confirms at all asks the operator to type the
 * skill's id.
 * @license GPL-3.0-only
 */

import type { Skill } from "./types";

export function batchConfirmPhrase(skill: Skill): string | undefined {
  const policy = skill.confirm;
  if (!policy || policy.gesture === "tap") return undefined;
  return skill.id.toUpperCase();
}
