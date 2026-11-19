/**
 * @module hud/cockpit-surfaces
 * @description The cockpit's `surfaces` nav-stream kind: landing-zone
 * candidates per camera. The parser narrows the snake-case payload into the
 * camelCase shape the layer renderers read and returns null for anything
 * malformed. Dependency-free and re-exported from `cockpit-frames.ts`, which
 * Mission Control copies byte for byte with it.
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
function pts2(v: unknown): [number, number][] {
  if (!Array.isArray(v)) return [];
  const out: [number, number][] = [];
  for (const p of v) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const a = num(p[0]);
    const b = num(p[1]);
    if (a !== null && b !== null) out.push([a, b]);
  }
  return out;
}

export interface SurfaceZone {
  pts: [number, number][];
  score: number;
  slopeDeg: number | null;
}

export interface SurfacesFrame {
  tsMs: number;
  cameraId: string;
  zones: SurfaceZone[];
}

export function parseSurfacesFrame(raw: unknown): SurfacesFrame | null {
  const o = obj(raw);
  const cameraId = o && typeof o.camera_id === "string" ? o.camera_id : null;
  if (!o || cameraId === null || !Array.isArray(o.zones)) return null;
  const zones: SurfaceZone[] = [];
  for (const z of o.zones) {
    const zo = obj(z);
    const pts = zo ? pts2(zo.pts) : [];
    if (!zo || pts.length < 3) continue;
    zones.push({ pts, score: num(zo.score) ?? 0, slopeDeg: num(zo.slope_deg) });
  }
  return { tsMs: num(o.ts_ms) ?? 0, cameraId, zones };
}
