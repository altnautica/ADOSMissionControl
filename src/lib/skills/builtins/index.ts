/**
 * The canonical built-in skill set, exactly the shared cockpit spec's table
 * (`lib/cockpit-spec/builtins.json`). Each built-in is a thin adapter over the
 * pilot action (ADOS pilot route) or the protocol call (FC manual, direct
 * link), with the spec's confirm tier and arm gate. FC mode presets are
 * registered for the Mode sheet and the node board but never slotted.
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
import { takeControlSkill } from "./take-control";
import { killSkill } from "./kill";
import { modeSkills } from "./modes";
import { setModeSkill } from "./set-mode";
import { flyHereSkill } from "./fly-here";

/** Every built-in skill, in registration order. */
export const builtinSkills: Skill[] = [
  armSkill,
  disarmSkill,
  takeoffSkill,
  landSkill,
  rthSkill,
  pauseSkill,
  resumeSkill,
  takeControlSkill,
  killSkill,
  // FC mode presets: offered by the Mode sheet and the node board, never
  // slotted in the default loadout.
  ...modeSkills,
  // Parameterised, not bindable: dispatched by the Mode sheet's FC modes.
  setModeSkill,
  // Parameterised, not bindable: dispatched by the Fly Here dialog.
  flyHereSkill,
];

export {
  armSkill,
  disarmSkill,
  takeoffSkill,
  landSkill,
  rthSkill,
  pauseSkill,
  resumeSkill,
  takeControlSkill,
  killSkill,
  modeSkills,
  setModeSkill,
  flyHereSkill,
};
