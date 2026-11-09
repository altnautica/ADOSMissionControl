/**
 * @module hud/hud-copy
 * @description The HUD target tag strings. The resolver formats tags through
 * this table so a surface can pass its translated copy while tests and
 * non-React callers use the English default. The agent cockpit's Feed is not
 * translated, so it uses the English table. Uppercase state words stay
 * uppercase in every locale.
 *
 * @license GPL-3.0-only
 */

export interface HudCopy {
  candidate: (cls: string, pct: number) => string;
  tracked: (cls: string, id: number) => string;
  track: (pct: number) => string;
  lock: (id: number, pct: number) => string;
  acquiring: (id: number) => string;
  coast: (s: string) => string;
  searching: () => string;
  searchingBearing: (deg: string) => string;
  lost: () => string;
  hold: (reason: string) => string;
  holdBare: () => string;
  followStale: () => string;
  est: (range: string) => string;
  gt: (cls: string, id: number) => string;
  uncertain: (tag: string) => string;
  reacquired: (id: number, sim: string, gap: string) => string;
}

export const HUD_COPY_EN: HudCopy = {
  candidate: (cls, pct) => `${cls} ${pct}%`,
  tracked: (cls, id) => `${cls} #${id}`,
  track: (pct) => `TRACK ${pct}%`,
  lock: (id, pct) => `LOCK #${id} ${pct}%`,
  acquiring: (id) => `ACQUIRING #${id}`,
  coast: (s) => `COAST ${s} s`,
  searching: () => "SEARCHING",
  searchingBearing: (deg) => `SEARCHING · ${deg}°`,
  lost: () => "LOST",
  hold: (reason) => `HOLD · ${reason}`,
  holdBare: () => "HOLD",
  followStale: () => "FOLLOW STALE",
  est: (range) => `${range} m EST`,
  gt: (cls, id) => `GT ${cls} #${id}`,
  uncertain: (tag) => `${tag} ?`,
  reacquired: (id, sim, gap) => `Re-acquired #${id} · ${sim} · ${gap} s gap`,
};
