/**
 * The canonical built-in skill set. Each built-in is a thin adapter over an
 * existing protocol call with a declarative confirm/arm gate; the registry
 * enforces the gates uniformly. The list order here is the default bar order
 * within each category.
 *
 * @module skills/builtins
 * @license GPL-3.0-only
 */

import type { Skill } from "../types";
import { armSkill } from "./arm";
import { disarmSkill } from "./disarm";
import { takeoffSkill } from "./takeoff";
import { landSkill } from "./land";
import { rthSkill } from "./rth";
import { pauseSkill } from "./pause";
import { resumeSkill } from "./resume";
import { abortSkill } from "./abort";
import { killSkill } from "./kill";
import { modeSkills } from "./modes";
import { setModeSkill } from "./set-mode";

/** Every built-in skill, in registration order. */
export const builtinSkills: Skill[] = [
  armSkill,
  disarmSkill,
  takeoffSkill,
  landSkill,
  rthSkill,
  pauseSkill,
  resumeSkill,
  abortSkill,
  killSkill,
  ...modeSkills,
  // Parameterised, not bindable: dispatched by the flight-mode dropdown.
  setModeSkill,
];

export {
  armSkill,
  disarmSkill,
  takeoffSkill,
  landSkill,
  rthSkill,
  pauseSkill,
  resumeSkill,
  abortSkill,
  killSkill,
  modeSkills,
  setModeSkill,
};
