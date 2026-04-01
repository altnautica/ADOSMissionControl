/**
 * @module map-constants
 * @description Shared constants for map-related components in the mission planner.
 * @license GPL-3.0-only
 */

/** Default map center: Bangalore, India (HAL Airport area). */
export const DEFAULT_CENTER: [number, number] = [12.95, 77.668];

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
} as const;

/** Convert a hex color (e.g. "#3a82ff") to an rgba string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
