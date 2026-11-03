/**
 * @module cockpit/width-class
 * @description The HUD width classes, computed from a container width (never
 * the viewport): `compact` < 600, `medium` 600–1023, `expanded` 1024–1599,
 * `tv` ≥ 1600 or a `?kiosk=1` surface. Shared by the cockpit chrome and the
 * target layer so every element switches at the same widths.
 *
 * @license GPL-3.0-only
 */

export type CockpitWidthClass = "compact" | "medium" | "expanded" | "tv";

export const WIDTH_MEDIUM_MIN = 600;
export const WIDTH_EXPANDED_MIN = 1024;
export const WIDTH_TV_MIN = 1600;

/** Width class for a container width. A kiosk surface is always `tv`. */
export function widthClassFor(width: number, kiosk: boolean): CockpitWidthClass {
  if (kiosk || width >= WIDTH_TV_MIN) return "tv";
  if (width >= WIDTH_EXPANDED_MIN) return "expanded";
  if (width >= WIDTH_MEDIUM_MIN) return "medium";
  return "compact";
}

/** True on a `?kiosk=1` surface. */
export function isKioskSearch(search: string): boolean {
  return new URLSearchParams(search).get("kiosk") === "1";
}
