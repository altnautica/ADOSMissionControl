/**
 * @module nav/radar-geometry
 * @description Pure geometry for the proximity radar's companion view: scan
 * dots on the dial, the 3 / 6 / 12 m display range with auto-select, and the
 * nearest-obstacle readout bands. Body-frame data is drawn with forward up.
 *
 * @license GPL-3.0-only
 */

import type { NavScan } from "@/lib/hud/nav-types";

export const RADAR_SCALES_M = [3, 6, 12] as const;
export type RadarScale = (typeof RADAR_SCALES_M)[number];
/** An operator-pinned scale, or `auto`. */
export type RadarScaleSetting = RadarScale | "auto";

export const RADAR_DANGER_M = 2;
export const RADAR_CAUTION_M = 5;
export const RADAR_MAX_DOTS = 360;
export const RADAR_MAX_DOTS_LOW_POWER = 120;

/** Auto range: 3 m when the nearest return is under 1.5 m, 12 m when nothing
 * is within 6 m, else 6 m. */
export function autoRadarScale(nearestM: number | null): RadarScale {
  if (nearestM !== null && nearestM < 1.5) return 3;
  if (nearestM === null || nearestM > 6) return 12;
  return 6;
}

/** Next pinned scale when the dial is tapped: 3 → 6 → 12 → auto → 3. */
export function cycleRadarScale(s: RadarScaleSetting): RadarScaleSetting {
  if (s === 3) return 6;
  if (s === 6) return 12;
  if (s === 12) return "auto";
  return 3;
}

/**
 * Dial positions for every return in `(0, displayRange]`:
 * `x = cx + r(ρ)·sin θ`, `y = cy − r(ρ)·cos θ`, `r(ρ) = ρ / displayRange · R`,
 * θ clockwise from forward. Capped at `maxDots` by even decimation.
 */
export function radarScanDots(
  scan: NavScan,
  displayRangeM: number,
  radiusPx: number,
  cx: number,
  cy: number,
  maxDots: number = RADAR_MAX_DOTS,
): Array<{ x: number; y: number }> {
  const all: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < scan.ranges.length; i++) {
    const rho = scan.ranges[i];
    if (!(rho > 0) || rho > displayRangeM) continue;
    const th = scan.angleStartRad + i * scan.angleIncrementRad;
    const r = (rho / displayRangeM) * radiusPx;
    all.push({ x: cx + r * Math.sin(th), y: cy - r * Math.cos(th) });
  }
  if (all.length <= maxDots) return all;
  const step = all.length / maxDots;
  const out: Array<{ x: number; y: number }> = [];
  for (let k = 0; k < maxDots; k++) out.push(all[Math.floor(k * step)]);
  return out;
}

/** Nearest scan return (m), or null when the scan has none. */
export function nearestScanM(scan: NavScan | null): number | null {
  if (!scan) return null;
  let best: number | null = null;
  for (const r of scan.ranges) if (r > 0 && (best === null || r < best)) best = r;
  return best;
}

export type RadarBand = "clear" | "caution" | "danger";

/** Band for the nearest obstacle: danger < 2 m, caution 2–5 m, else clear. */
export function radarBand(nearestM: number | null): RadarBand {
  if (nearestM === null || nearestM > RADAR_CAUTION_M) return "clear";
  return nearestM < RADAR_DANGER_M ? "danger" : "caution";
}
