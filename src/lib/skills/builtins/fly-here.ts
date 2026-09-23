/**
 * Fly Here skill — repositions the vehicle to a map point at an altitude
 * relative to home, then hands the target to the guided-target supervisor.
 *
 * Armed-only and not bindable: it carries no meaning without a point, so it is
 * dispatched by the Fly Here dialog and takes no bar slot or key binding. The
 * dialog's hold-to-confirm is its confirmation; going through the dispatcher
 * gives it the same arm gate, debounce and surfaced refusal as every other
 * flight command.
 *
 * @module skills/builtins/fly-here
 * @license GPL-3.0-only
 */

import type { CommandResult } from "@/lib/protocol/types";
import type { Skill, SkillActivateArgs } from "../types";
import { disabledIfNoLink, REASON } from "./_shared";
import { superviseGuidedTarget } from "../guided-target";
import { useDroneManager } from "@/stores/drone-manager";

/**
 * Fly Here altitude bounds, metres relative to home. The target is sent in a
 * home-relative frame, so 0 means "descend to home elevation" wherever the
 * point is; the floor keeps the vehicle clear of that.
 */
export const FLY_HERE_ALTITUDE_M = { min: 2, max: 120 } as const;

/**
 * Parse a typed Fly Here altitude. Returns metres, or `null` when the entry is
 * blank, not a number, or outside {@link FLY_HERE_ALTITUDE_M}.
 */
export function parseFlyHereAltitude(text: string): number | null {
  const alt = Number(text);
  if (text.trim() === "" || !Number.isFinite(alt)) return null;
  return alt >= FLY_HERE_ALTITUDE_M.min && alt <= FLY_HERE_ALTITUDE_M.max ? alt : null;
}

function refusal(message: string): CommandResult {
  return { success: false, resultCode: -1, message };
}

interface FlyHereTarget {
  lat: number;
  lon: number;
  altitudeM: number;
}

function flyHereTarget(args?: SkillActivateArgs): FlyHereTarget | null {
  const { lat, lon, altitudeM } = args ?? {};
  if (typeof lat !== "number" || !Number.isFinite(lat)) return null;
  if (typeof lon !== "number" || !Number.isFinite(lon)) return null;
  if (typeof altitudeM !== "number" || parseFlyHereAltitude(String(altitudeM)) === null) return null;
  return { lat, lon, altitudeM };
}

export const flyHereSkill: Skill = {
  id: "fly-here",
  label: "skills.flyHere",
  icon: "Navigation",
  category: "flight",
  source: "builtin",
  toggle: false,
  bindable: false,
  armRequirement: "armed",
  requiresAutonomousNav: true,
  getState: (ctx) => {
    const noLink = disabledIfNoLink(ctx);
    if (noLink) return noLink;
    if (ctx.armState !== "armed") return { kind: "disabled", reason: REASON.notArmed };
    return { kind: "idle" };
  },
  activate: async (ctx, args) => {
    const target = flyHereTarget(args);
    if (!target) {
      return refusal(
        `Fly Here needs a point and an altitude of ${FLY_HERE_ALTITUDE_M.min}-${FLY_HERE_ALTITUDE_M.max} m`,
      );
    }
    // The reposition needs the full protocol (guided goto and its supervisor),
    // which only a live connection to this drone provides.
    const protocol = useDroneManager.getState().drones.get(ctx.droneId)?.protocol;
    if (!protocol?.isConnected) return refusal(REASON.noFcLink);

    const result = await protocol.guidedGoto(target.lat, target.lon, target.altitudeM);
    if (result.success) {
      // The map shows the target until the vehicle arrives or leaves the
      // reposition mode; the supervisor owns both.
      superviseGuidedTarget(
        {
          droneId: ctx.droneId,
          lat: target.lat,
          lon: target.lon,
          alt: target.altitudeM,
          timestamp: Date.now(),
          purpose: "goto",
        },
        protocol,
        ctx.notify,
      );
    }
    return result;
  },
};
