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
import type { Skill, SkillActivateArgs, SkillContext } from "../types";
import { disabledIfNoLink, pilotActionResult, REASON, viaPilot } from "./_shared";
import { superviseGuidedTarget } from "../guided-target";
import { useDroneManager } from "@/stores/drone-manager";
import { useNavStreamStore } from "@/stores/nav-stream-store";

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

/** Pilot `goto` refusals the operator gets a sentence for; any other code is
 * shown as the pilot sent it. */
const PILOT_GOTO_REFUSALS = new Set(["bad_args", "not_armed", "landed", "tuning", "no_home"]);

/** True when this drone's ADOS pilot flies it from this surface and accepts a
 * `goto` from a surface. */
function pilotFliesGoto(ctx: SkillContext): boolean {
  if (!viaPilot(ctx)) return false;
  const ops = useNavStreamStore.getState().byDrone[ctx.droneId]?.pilot?.data.surfaceOps;
  return ops?.includes("goto") === true;
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
    const protocol = useDroneManager.getState().drones.get(ctx.droneId)?.protocol;
    let result: CommandResult;
    if (pilotFliesGoto(ctx)) {
      // The pilot owns the aircraft: it flies to the point itself (altitude
      // above home) and answers with an action result.
      result = await pilotActionResult("goto", { lat: target.lat, lon: target.lon, alt_m: target.altitudeM });
      if (!result.success && PILOT_GOTO_REFUSALS.has(result.message)) {
        result = { ...result, message: `skills.flyHere.refused.${result.message}` };
      }
    } else {
      // The reposition needs the full protocol (guided goto and its
      // supervisor), which only a live connection to this drone provides.
      if (!protocol?.isConnected) return refusal(REASON.noFcLink);
      result = await protocol.guidedGoto(target.lat, target.lon, target.altitudeM);
    }
    if (result.success && protocol?.isConnected) {
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
