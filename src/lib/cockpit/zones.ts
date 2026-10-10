/**
 * @module cockpit/zones
 * @description The cockpit's placement grammar. A widget (built-in or plugin)
 * declares the ZONE it wants to sit in; the host owns the actual positioning by
 * rendering one absolutely-anchored container per zone and stacking the zone's
 * widgets inside it. This is the neutral, dependency-free home for the zone
 * enum + its CSS anchor mapping so both the widget registry (`widget-registry`)
 * and the persisted layout slice (`settings/keybindings-slice`) can import it
 * without a cycle.
 *
 * @license GPL-3.0-only
 */

/** The nine placement zones over the video, plus a full-bleed centre layer. */
export type CockpitZone =
  | "top-left"
  | "top-center"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right"
  | "full";

/** Every zone, in a stable reading order (used to build the editor + defaults). */
export const COCKPIT_ZONES: readonly CockpitZone[] = [
  "top-left",
  "top-center",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
  "full",
] as const;

/** Short suffix a zone maps to on the `cockpit-zone` container class. */
const ZONE_SUFFIX: Record<CockpitZone, string> = {
  "top-left": "tl",
  "top-center": "tc",
  "top-right": "tr",
  left: "ml",
  center: "cc",
  right: "mr",
  "bottom-left": "bl",
  "bottom-center": "bc",
  "bottom-right": "br",
  full: "full",
};

/**
 * The container class for a zone: `cockpit-zone <suffix>`. The host wraps a
 * zone's widgets in `<div className={zoneContainerClass(zone)}>`; the anchoring
 * lives in `globals.css` (`.ados-cockpit .cockpit-zone.<suffix>`).
 */
export function zoneContainerClass(zone: CockpitZone): string {
  return `cockpit-zone ${ZONE_SUFFIX[zone]}`;
}
