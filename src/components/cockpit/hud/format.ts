/**
 * @module cockpit/hud/format
 * @description Number formatting shared by the cockpit HUD instruments. A null
 * or non-finite reading formats as the no-data glyph, never as 0.
 * @license GPL-3.0-only
 */

import { NO_DATA_GLYPH } from "@/lib/hud-draw";

/** `value` to `digits` decimals, or the no-data glyph. */
export function formatHud(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA_GLYPH;
  return value.toFixed(digits);
}

/** A rate with an explicit sign (`+1.2`, `-0.4`), or the no-data glyph. */
export function formatSigned(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA_GLYPH;
  const text = value.toFixed(digits);
  // -0.0 reads as a descent that is not happening.
  if (Number(text) === 0) return (0).toFixed(digits);
  return value > 0 ? `+${text}` : text;
}

/** A heading as three digits (`007`), or the no-data glyph. */
export function formatHeading(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return NO_DATA_GLYPH;
  const deg = ((Math.round(value) % 360) + 360) % 360;
  return String(deg).padStart(3, "0");
}
