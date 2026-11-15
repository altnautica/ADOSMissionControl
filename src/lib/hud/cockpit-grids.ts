/**
 * @module hud/cockpit-grids
 * @description The per-camera grids of the cockpit v2 nav-stream kinds
 * `obstacles` (radar sectors and per-camera nearness grids) and `depth` (the
 * model depth grid), parsed apart from `cockpit-frames.ts`, plus the grid
 * code scale and the allocation-free base64 decoder the renderer reads them
 * with. `cockpit-frames.ts` re-exports everything here.
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
function oneOf<T extends string>(v: unknown, values: readonly T[]): T | null {
  return typeof v === "string" && (values as readonly string[]).includes(v) ? (v as T) : null;
}

// ── per-camera grids (nav kinds `obstacles` / `depth`) ───────────────────────────

/** A per-camera grid: `near` holds cols·rows log-coded distances (0 =
 *  unknown); `measured` is a cols·rows bitmask (1 = from LiDAR/occupancy). */
export interface CameraGrid {
  cols: number;
  rows: number;
  near: string;
  measured: string | null;
  /** Depth only: per-camera scale source (authoritative over the frame's). */
  scaleSource: "lidar" | "none" | null;
}

function parseGrids(raw: unknown): Record<string, CameraGrid> {
  const out: Record<string, CameraGrid> = {};
  const cams = obj(raw);
  if (!cams) return out;
  for (const id of Object.keys(cams)) {
    const g = obj(cams[id]);
    if (!g) continue;
    const cols = num(g.cols);
    const rows = num(g.rows);
    const near = str(g.near);
    if (cols === null || rows === null || near === null || cols <= 0 || rows <= 0 || cols * rows > 65536) continue;
    out[id] = { cols, rows, near, measured: str(g.measured), scaleSource: oneOf(g.scale_source, ["lidar", "none"] as const) };
  }
  return out;
}

export interface ObstaclesFrame {
  tsMs: number;
  /** 72 × 5° sectors, body yaw 0 = nose, clockwise; null = no return. */
  sectorsM: (number | null)[];
  cameras: Record<string, CameraGrid>;
}

export function parseObstaclesFrame(raw: unknown): ObstaclesFrame | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.sectors_m)) return null;
  const sectorsM: (number | null)[] = [];
  for (let i = 0; i < 72; i++) sectorsM.push(num(o.sectors_m[i]));
  return { tsMs: num(o.ts_ms) ?? 0, sectorsM, cameras: parseGrids(o.cameras) };
}

export interface DepthFrame {
  tsMs: number;
  scaleSource: "lidar" | "none";
  cameras: Record<string, CameraGrid>;
}

export function parseDepthFrame(raw: unknown): DepthFrame | null {
  const o = obj(raw);
  if (!o || !obj(o.cameras)) return null;
  return {
    tsMs: num(o.ts_ms) ?? 0,
    scaleSource: o.scale_source === "lidar" ? "lidar" : "none",
    cameras: parseGrids(o.cameras),
  };
}

/** Grid cell code → metres: 0 is unknown (null); 1..255 span 0.2–60 m. */
export function decodeGridCode(v: number): number | null {
  if (v <= 0) return null;
  return 0.2 * Math.exp(((v - 1) * Math.log(300)) / 254);
}

/** Metres → the smallest code whose distance is ≥ `m` (for thresholds). */
export function gridCodeFor(m: number): number {
  if (m <= 0.2) return 1;
  return Math.min(255, Math.ceil((Math.log(m / 0.2) * 254) / Math.log(300) + 1));
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t["-".charCodeAt(0)] = 62;
  t["_".charCodeAt(0)] = 63;
  return t;
})();

/** Decode standard or url-safe base64 into `out` without allocating.
 *  Returns the byte count written (capped at `out.length`). */
export function decodeBase64Into(s: string, out: Uint8Array): number {
  let acc = 0;
  let bits = 0;
  let n = 0;
  for (let i = 0; i < s.length && n < out.length; i++) {
    const c = s.charCodeAt(i);
    const v = c < 128 ? B64_INDEX[c] : -1;
    if (v < 0) continue; // padding, whitespace
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return n;
}
