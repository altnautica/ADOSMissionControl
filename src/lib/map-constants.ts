/**
 * @module map-constants
 * @description Shared constants for map-related components in the mission planner.
 * @license GPL-3.0-only
 */

/**
 * Map center of last resort: Null Island, at a zoom that shows most of the
 * globe.
 *
 * Every real caller has something better and should prefer it — the
 * operator's GPS position, the drone's position, the mission's home point,
 * the first waypoint of a flight record. This constant is what a surface
 * shows when it knows NOTHING, and it deliberately names nowhere: a city
 * centroid here silently told every operator outside that city that their
 * map was positioned, when in fact nothing had been resolved.
 */
export const DEFAULT_CENTER: [number, number] = [0, 0];

/** Zoom paired with {@link DEFAULT_CENTER}: wide enough to read as "unlocated". */
export const DEFAULT_ZOOM_UNLOCATED = 2;

/** Design-system color tokens used across map components. */
export const MAP_COLORS = {
  /** Primary accent — waypoint fill, path stroke, chart stroke. */
  accentPrimary: "#3a82ff",
  /** Secondary accent — selected waypoint fill. */
  accentSelected: "#dff140",
  /** Light foreground — unselected waypoint stroke, dot fill. */
  foreground: "#fafafa",
  /** Dark background — selected waypoint text. */
  background: "#0a0a0f",
  /** Muted text — segment labels. */
  muted: "#9ca3af",
  /** Geofence / danger boundary — red. */
  fence: "#ef4444",
  /** Rally point — orange. */
  rally: "#f97316",
  /** Point of interest (plan annotation) — violet, distinct from waypoint/rally/fence. */
  poi: "#a855f7",
} as const;

/** Convert a hex color (e.g. "#3a82ff") to an rgba string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
