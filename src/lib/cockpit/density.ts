/**
 * @module cockpit/density
 * @description The cockpit information-density model. A density mode gates how
 * much read-only chrome the immersive cockpit shows: `minimal` keeps only the
 * instruments and the safety band, `standard` adds the standard cards, and
 * `full` shows everything. A registered widget states the least dense mode it
 * appears at (`minDensity`), and the widget composer decides with
 * {@link meetsDensity}. Kept in one dependency-free module so both the density
 * control and the persisted loadout layout reference the same type + default
 * without a component ⇄ store import.
 *
 * @license GPL-3.0-only
 */

/** How dense the cockpit read-outs are: fewer cards → more video. */
export type CockpitDensity = "minimal" | "standard" | "full";

/** The density modes in display order (Min · Std · Full). */
export const COCKPIT_DENSITIES: readonly CockpitDensity[] = [
  "minimal",
  "standard",
  "full",
];

/** The factory density: a balanced set of cards over the video. */
export const DEFAULT_DENSITY: CockpitDensity = "standard";

/** Rank, so "at least this dense" is a comparison rather than a lookup table. */
const DENSITY_RANK: Record<CockpitDensity, number> = {
  minimal: 0,
  standard: 1,
  full: 2,
};

/**
 * Whether a widget that needs at least `required` density shows at `active`.
 *
 * This is the code path for a decision the `.d-std` / `.d-full` CSS classes
 * used to make. Those classes lived on each widget's own positioning wrapper,
 * so density was decided in the stylesheet while visibility was decided in the
 * registry — two mechanisms for one question, and the CSS one only worked for
 * a widget that brought its own wrapper. A widget composed into a shared zone
 * container has no wrapper of its own to hang a class on.
 */
export function meetsDensity(
  required: CockpitDensity,
  active: CockpitDensity,
): boolean {
  return DENSITY_RANK[active] >= DENSITY_RANK[required];
}
