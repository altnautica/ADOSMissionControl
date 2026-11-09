/**
 * @module hud/occupancy-bitmap
 * @description Pixel recolouring for live occupancy tiles. A tile arrives as
 * a greyscale map_server PNG; each pixel is classified once at decode
 * (`occupancyClass`) and painted occupied / free / transparent in the HUD ink
 * colour, so drawing a tile is a single nearest-neighbour `drawImage`.
 *
 * @license GPL-3.0-only
 */

import { occupancyClass } from "./local-frame";

/** An RGBA colour with 0–255 channels. */
export type Rgba = readonly [number, number, number, number];

/** Occupied cells: ink at 90 %. Free cells: ink at 10 %. */
export const OCCUPIED_ALPHA = 0.9;
export const FREE_ALPHA = 0.1;

/**
 * Parse a computed CSS colour (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`,
 * `rgb()` / `rgba()`). Returns null for any other syntax; callers fall back
 * to a canvas probe.
 */
export function parseCssColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,8})$/.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3 || h.length === 4) {
      const c = [...h].map((ch) => parseInt(ch + ch, 16));
      return [c[0], c[1], c[2], h.length === 4 ? c[3] : 255];
    }
    if (h.length === 6 || h.length === 8) {
      const c = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      return [c[0], c[1], c[2], h.length === 8 ? c[3] : 255];
    }
    return null;
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(s);
  if (!fn) return null;
  const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3) return null;
  const ch = parts.slice(0, 3).map(Number);
  if (ch.some((v) => !Number.isFinite(v))) return null;
  let a = 255;
  if (parts[3] !== undefined) {
    const raw = parts[3];
    const v = raw.endsWith("%") ? Number(raw.slice(0, -1)) / 100 : Number(raw);
    if (!Number.isFinite(v)) return null;
    a = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return [ch[0], ch[1], ch[2], a];
}

/** `ink` with its own alpha scaled by `alpha` (0–1). */
export function withAlpha(ink: Rgba, alpha: number): Rgba {
  return [ink[0], ink[1], ink[2], Math.round(ink[3] * alpha)];
}

/**
 * Recolour a decoded greyscale tile (RGBA, the grey value in the red
 * channel) in place: occupied → `occupied`, free → `free`, unknown →
 * transparent. A transparent source pixel stays transparent.
 */
export function recolourOccupancy(data: Uint8ClampedArray, occupied: Rgba, free: Rgba): Uint8ClampedArray {
  for (let i = 0; i + 3 < data.length; i += 4) {
    const cls = data[i + 3] === 0 ? "unknown" : occupancyClass(data[i]);
    const c = cls === "occupied" ? occupied : cls === "free" ? free : null;
    if (c) {
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = c[3];
    } else {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 0;
    }
  }
  return data;
}
