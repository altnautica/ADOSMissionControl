/**
 * @module cockpit/width-class
 * @description The HUD width classes, computed from a container width (never
 * the viewport), from the shared cockpit spec `layout.json`: `compact` < 600,
 * `medium` 600–839, `expanded` 840–1599, `tv` ≥ 1600 or a `?kiosk=1`
 * surface. Shared by the cockpit chrome and the target layer so every element
 * switches at the same widths, on every surface.
 *
 * @license GPL-3.0-only
 */

import layoutSpec from "@/lib/cockpit/spec/layout.json";

export type CockpitWidthClass = "compact" | "medium" | "expanded" | "tv";

function classMin(id: CockpitWidthClass): number {
  const c = layoutSpec.breakpoints.classes.find((k) => k.id === id);
  if (!c) throw new Error(`cockpit spec layout.json has no width class ${id}`);
  return c.min;
}

export const WIDTH_MEDIUM_MIN = classMin("medium");
export const WIDTH_EXPANDED_MIN = classMin("expanded");
export const WIDTH_TV_MIN = classMin("tv");

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
