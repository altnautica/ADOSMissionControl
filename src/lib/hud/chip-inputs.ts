// The inputs of the flight-state chip and the bottom row drawn from the
// pilot kind and what sits beside it (the FC's local position, the newest `ar`
// frame, the active skill's detail). Pure, so every surface builds the chip
// facts the same way.

import type { ArFrame, PilotState } from "./cockpit-frames";
import { chipFacts, type ChipFacts } from "./flight-state";
import { specText } from "./spec-text";

/** An `ar` frame older than this carries no ETA. */
const AR_ETA_MAX_AGE_MS = 2000;

/** The bottom row's height above ground and what it was measured with.
 *  `mark` names a source that is not a ground measurement (the pilot kind's
 *  EKF height above home, the follow kind's barometer), shown beside the
 *  value in the warning colour so it never reads as a measured AGL. */
export interface BottomRowAgl {
  m: number | null;
  mark: "HOME" | "BARO" | null;
}

/** Height above ground for the bottom row: the pilot kind's `agl_m` (a fresh
 *  rangefinder, else the EKF height above home, marked HOME), else the
 *  follow kind's (marked BARO from the barometer). */
export function bottomRowAgl(
  pilot: Pick<PilotState, "aglM" | "aglSource"> | null,
  follow: { aglM: number | null; aglSource: "rng" | "baro" | null } | null,
): BottomRowAgl {
  if (pilot?.aglM != null) return { m: pilot.aglM, mark: pilot.aglSource === "rangefinder" ? null : "HOME" };
  if (follow?.aglM != null) return { m: follow.aglM, mark: follow.aglSource === "baro" ? "BARO" : null };
  return { m: null, mark: null };
}

/** The spec text of an AGL mark (`agl.source.home` / `agl.source.baro`), or
 *  null for a measured height. */
export function aglMarkText(mark: BottomRowAgl["mark"]): string | null {
  if (mark === "HOME") return specText("agl.source.home");
  if (mark === "BARO") return specText("agl.source.baro");
  return null;
}

/** The ETA of the next waypoint in an `ar` frame, from whichever camera
 *  carries it (the agent computes one ETA per waypoint, the same in every
 *  camera). Null when the frame is older than 2 s or names no next waypoint. */
export function nextWaypointEtaS(frame: ArFrame | null, ageMs: number): number | null {
  if (!frame || ageMs > AR_ETA_MAX_AGE_MS) return null;
  for (const id in frame.cameras) {
    for (const it of frame.cameras[id].items) {
      if (it.t === "wp" && it.role === "next" && it.etaS !== null) return it.etaS;
    }
  }
  return null;
}

/** Horizontal distance (m) from the FC's local position to the pilot goal,
 *  both NED about the same origin. Null when either is missing. */
export function goalDistanceM(
  lp: { x: number; y: number } | null | undefined,
  goal: [number, number, number] | null,
): number | null {
  if (!lp || !goal) return null;
  return Math.hypot(goal[0] - lp.x, goal[1] - lp.y);
}

/** What a surface knows beside the pilot kind. A surface without one of
 *  these passes null (and 0 for `arAgeMs` with no frame). */
export interface ChipContext {
  homeDistM: number | null;
  localPos: { x: number; y: number } | null;
  arFrame: ArFrame | null;
  /** Age of `arFrame` in ms, on a monotonic clock. */
  arAgeMs: number;
  /** The running skill's detail line; used only while a skill owns. */
  modeDetail: string | null;
  /** Ms since the mission turned `complete`, or null. */
  completeAgeMs: number | null;
}

/** The chip facts for one pilot state received at `pilotAtMs`, read at
 *  `nowMs` (same clock). */
export function chipInputs(pilot: PilotState, nowMs: number, pilotAtMs: number, ctx: ChipContext): ChipFacts {
  return chipFacts(pilot, nowMs - pilotAtMs, {
    homeDistM: ctx.homeDistM,
    modeDetail: pilot.owner === "skill" ? ctx.modeDetail : null,
    completeAgeMs: ctx.completeAgeMs,
    distM: goalDistanceM(ctx.localPos, pilot.goalNed),
    etaS: nextWaypointEtaS(ctx.arFrame, ctx.arAgeMs),
  });
}
