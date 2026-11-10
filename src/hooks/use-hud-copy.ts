"use client";

/**
 * @module use-hud-copy
 * @description The HUD target tag copy for the target resolver, all shared
 * cockpit spec text (`hud.target.*`, `follow.phase.*`,
 * `follow.reacquired_toast`).
 *
 * @license GPL-3.0-only
 */

import { specString } from "@/lib/cockpit/spec-strings";
import type { HudCopy } from "@/lib/hud/hud-copy";

const HUD_COPY: HudCopy = {
  candidate: (label, pct) => specString("hud.target.candidate", { label, pct }),
  tracked: (label, id) => specString("hud.target.tracked", { label, id }),
  track: (pct) => specString("hud.target.track", { pct }),
  lock: (id, pct) => specString("hud.target.lock", { id, pct }),
  acquiring: (id) => specString("hud.target.acquiring", { id }),
  coast: (s) => specString("hud.target.coast", { s }),
  searching: () => specString("follow.phase.searching"),
  searchingBearing: (deg) => specString("hud.target.searching_bearing", { deg }),
  lost: () => specString("follow.phase.lost"),
  hold: (label) => specString("hud.target.hold", { label }),
  holdBare: () => specString("follow.phase.holding"),
  followStale: () => specString("hud.target.follow_stale"),
  est: (m) => specString("hud.target.est", { m }),
  gt: (cls, id) => specString("hud.target.gt", { cls, id }),
  uncertain: (v) => specString("hud.target.uncertain", { v }),
  reacquired: (id, sim, gap) => specString("follow.reacquired_toast", { id, sim, gap }),
};

export function useHudCopy(): HudCopy {
  return HUD_COPY;
}
