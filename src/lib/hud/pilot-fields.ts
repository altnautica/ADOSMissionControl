/**
 * @module hud/pilot-fields
 * @description Smaller parts of the `pilot` kind, parsed apart from
 * `cockpit-frames.ts`: the horizontal speed cap (`speed_cap`, and its value
 * as the flight-state chip prints it) and the FC's STATUSTEXT lines.
 *
 * Dependency-free on purpose: Mission Control copies this file byte for byte.
 *
 * @license GPL-3.0-only
 */

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/** The pilot's horizontal speed cap: why, and the limit in m/s. */
export interface SpeedCap {
  reason: string;
  vHMps: number;
}

/** `speed_cap` from the pilot frame, or null when absent or malformed. */
export function parseSpeedCap(raw: unknown): SpeedCap | null {
  const o = obj(raw);
  const reason = o ? str(o.reason) : null;
  const vHMps = o ? num(o.v_h_mps) : null;
  return reason !== null && vHMps !== null ? { reason, vHMps } : null;
}

/** The cap in m/s with at most one decimal (1.5 → "1.5", 2 → "2"), the same
 *  on every surface. */
export function speedCapText(vHMps: number): string {
  return String(Math.round(vHMps * 10) / 10);
}

/** One FC STATUSTEXT line; severity is MAVLink's (0 emergency … 4 warning). */
export interface FcStatusText {
  severity: number;
  text: string;
  ageMs: number;
}

/** `statustext` from the pilot frame: at most 8 well-formed lines. */
export function parseStatusText(raw: unknown): FcStatusText[] {
  if (!Array.isArray(raw)) return [];
  const out: FcStatusText[] = [];
  for (const r of raw.slice(0, 8)) {
    const o = obj(r);
    const text = o ? str(o.text) : null;
    const severity = o ? num(o.severity) : null;
    if (!o || text === null || severity === null) continue;
    out.push({ severity, text, ageMs: num(o.age_ms) ?? 0 });
  }
  return out;
}
