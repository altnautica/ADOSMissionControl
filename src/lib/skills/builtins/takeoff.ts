/**
 * Take-off skill — arms then commands an autonomous take-off to the requested
 * altitude (default 10 m). One-shot, disarmed-only, danger confirm with the
 * checklist-aware OVERRIDE escalation. Requires autonomous nav.
 *
 * @module skills/builtins/takeoff
 * @license GPL-3.0-only
 */

import type { Skill, SkillActivateArgs } from "../types";
import { disabledIfNoLink, disabledUnlessDisarmed } from "./_shared";

/** Take-off altitude bounds and default, metres above home. */
export const TAKEOFF_ALTITUDE_M = { min: 1, max: 120, default: 10 } as const;

/**
 * Parse a typed take-off altitude. Returns metres, or `null` when the entry is
 * blank, not a number, or outside {@link TAKEOFF_ALTITUDE_M}.
 */
export function parseTakeoffAltitude(text: string): number | null {
  const alt = Number(text);
  if (text.trim() === "" || !Number.isFinite(alt)) return null;
  return alt >= TAKEOFF_ALTITUDE_M.min && alt <= TAKEOFF_ALTITUDE_M.max ? alt : null;
}

function takeoffAltitude(args?: SkillActivateArgs): number {
  return typeof args?.altitudeM === "number" && args.altitudeM > 0
    ? args.altitudeM
    : TAKEOFF_ALTITUDE_M.default;
}

export const takeoffSkill: Skill = {
  id: "takeoff",
  label: "skills.takeoff",
  icon: "ArrowUpFromLine",
  category: "flight",
  source: "builtin",
  toggle: false,
  armRequirement: "disarmed",
  requiresAutonomousNav: true,
  confirm: {
    title: "skills.takeoff.confirm.title",
    message: "skills.takeoff.confirm.message",
    confirmLabel: "skills.takeoff.confirm.button",
    variant: "danger",
    typedPhrase: "TAKEOFF",
    checklistAware: true,
  },
  // The dialog names the altitude that will be commanded, so a mistyped value
  // is visible before the operator confirms.
  confirmValues: (args) => ({ altitude: takeoffAltitude(args) }),
  getState: (ctx) => disabledIfNoLink(ctx) ?? disabledUnlessDisarmed(ctx) ?? { kind: "idle" },
  activate: async (ctx, args) => {
    if (!ctx.protocol) return;
    const altitudeM = takeoffAltitude(args);
    // A refused arm ends the take-off: commanding a climb after the vehicle
    // declined to arm would dispatch blind, so the refusal is what goes back
    // to the dispatcher (which surfaces it and spends nothing).
    const armed = await ctx.protocol.arm();
    if (armed.success === false) return armed;
    return ctx.protocol.takeoff(altitudeM);
  },
};
