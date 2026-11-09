/**
 * @module hud/layer-layout
 * @description The cockpit layer draw list, shared by every web surface that
 * draws the cockpit data layers over a video (the agent cockpit and kiosk, the
 * agent dashboard, and Mission Control's copy). Its painter, `paintOps`, is in
 * `layer-paint` in Mission Control.
 *
 * A layer is laid out into a `DrawOpBuffer`: a reusable list of draw
 * operations in CSS pixels of the overlay canvas. Ops are recycled frame to
 * frame (the buffer grows once and keeps its objects), so steady-state layout
 * and paint allocate nothing. Each op carries a stable key `k`; `lerpOps`
 * blends the two newest layouts of the same key so 10–20 Hz data moves
 * smoothly at display refresh, and fades items in and out over FADE_MS.
 *
 * Also here: the per-camera grid cells of the `obstacles` and `depth` layers
 * (`layoutCells`), the bottom-centre obstacle arc (`layoutSectorArc`) and the
 * landing-zone polygons of the `surfaces` layer (`layoutZones`).
 *
 * Dependency-free apart from `cockpit-frames`.
 *
 * @license GPL-3.0-only
 */

import { decodeGridCode, gridCodeFor, type SurfaceZone } from "./cockpit-frames";

// ── tokens (cockpit-spec tokens.json `ar` and `layer`) ─────────────────────

export const LAYER_COLORS = {
  route: "#FF3EC8",
  future: "#FFFFFF",
  home: "#FFD400",
  follow: "#22D3EE",
  detour: "#F59E0B",
  blocked: "#EF4444",
  halo: "#000000",
  paused: "#909090",
  near: "#EF4444",
  mid: "#F59E0B",
  zone: "#00C853",
} as const;
/** Halo opacity and the extra width each stroke's halo gets (px per side). */
export const HALO_ALPHA = 0.6;
export const HALO_PX = 2;
/** Fade in / out of an item that appears or disappears between frames. */
export const FADE_MS = 120;

// ── draw ops ──────────────────────────────────────────────────────────────

export type DrawKind =
  /** Polyline through `pts` (closed when `closed`). */
  | "line"
  /** Filled polygon through `pts` (optionally stroked). */
  | "poly"
  /** Axis-aligned rect: x, y, w, h. */
  | "rect"
  /** Circle at x, y radius r. */
  | "circle"
  /** Triangle marker pointing down, apex at x, y, size r. */
  | "tri"
  /** Arrow glyph at x, y pointing along `ang` (screen radians), size r. */
  | "arrow"
  /** Winged flight-path circle at x, y radius r. */
  | "fpv"
  /** Cross ✕ at x, y, half-size r. */
  | "cross"
  /** "H" landing pad at x, y, size r. */
  | "pad"
  /** Text chip: `text` on a dark plate, anchored at x, y (`align`). */
  | "chip"
  /** Bare text with a halo. */
  | "text"
  /** Chevron at x, y along `ang`, size r. */
  | "chevron";

export interface DrawOp {
  k: string;
  kind: DrawKind;
  color: string;
  alpha: number;
  width: number;
  /** Dash length (0 = solid). */
  dash: number;
  /** Fill colour (null = no fill). */
  fill: string | null;
  fillAlpha: number;
  /** Flat x,y pairs; `n` points valid. Reused across frames. */
  pts: number[];
  n: number;
  closed: boolean;
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  ang: number;
  text: string;
  align: "left" | "center" | "right";
  halo: boolean;
}

function blankOp(): DrawOp {
  return {
    k: "",
    kind: "line",
    color: "#fff",
    alpha: 1,
    width: 1,
    dash: 0,
    fill: null,
    fillAlpha: 1,
    pts: [],
    n: 0,
    closed: false,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    r: 0,
    ang: 0,
    text: "",
    align: "center",
    halo: true,
  };
}

/** A reusable op list: `ops[0..n)` are live. `push` hands out a recycled op
 *  reset to defaults. */
export class DrawOpBuffer {
  ops: DrawOp[] = [];
  n = 0;

  clear(): void {
    this.n = 0;
  }

  push(k: string, kind: DrawKind): DrawOp {
    let op = this.ops[this.n];
    if (!op) {
      op = blankOp();
      this.ops.push(op);
    }
    this.n++;
    op.k = k;
    op.kind = kind;
    op.color = "#fff";
    op.alpha = 1;
    op.width = 1;
    op.dash = 0;
    op.fill = null;
    op.fillAlpha = 1;
    op.n = 0;
    op.closed = false;
    op.x = op.y = op.w = op.h = op.r = op.ang = 0;
    op.text = "";
    op.align = "center";
    op.halo = true;
    return op;
  }

  /** Append a point to `op`, in px. */
  static addPt(op: DrawOp, x: number, y: number): void {
    const i = op.n * 2;
    op.pts[i] = x;
    op.pts[i + 1] = y;
    op.n++;
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The letterboxed (object-contain) rect of a `fw`×`fh` frame in a box. */
export function containRect(boxW: number, boxH: number, fw: number, fh: number): Rect {
  if (fw <= 0 || fh <= 0 || boxW <= 0 || boxH <= 0) return { x: 0, y: 0, w: boxW, h: boxH };
  const s = Math.min(boxW / fw, boxH / fh);
  const w = fw * s;
  const h = fh * s;
  return { x: (boxW - w) / 2, y: (boxH - h) / 2, w, h };
}

// ── interpolation ─────────────────────────────────────────────────────────

function copyOp(dst: DrawOp, src: DrawOp): void {
  const pts = dst.pts;
  Object.assign(dst, src);
  dst.pts = pts;
  for (let i = 0; i < src.n * 2; i++) pts[i] = src.pts[i];
}

/**
 * Blend `prev` → `next` into `out`. Ops whose key is in both move linearly by
 * `t` (0..1); ops only in `next` fade in by `fade`, ops only in `prev` fade
 * out by `fade` (0..1, time since `next` arrived over FADE_MS). Ops with an
 * empty key (grid cells) are copied from `next` as they are.
 */
export function lerpOps(prev: DrawOpBuffer, next: DrawOpBuffer, t: number, fade: number, out: DrawOpBuffer): void {
  out.clear();
  const tt = Math.min(1, Math.max(0, t));
  const ff = Math.min(1, Math.max(0, fade));
  for (let i = 0; i < next.n; i++) {
    const b = next.ops[i];
    const o = out.push(b.k, b.kind);
    copyOp(o, b);
    if (b.k === "") continue;
    let a: DrawOp | null = null;
    for (let j = 0; j < prev.n; j++) {
      const p = prev.ops[j];
      if (p.k === b.k && p.kind === b.kind) {
        a = p;
        break;
      }
    }
    if (!a) {
      o.alpha *= ff;
      o.fillAlpha *= ff;
      continue;
    }
    o.x = a.x + (b.x - a.x) * tt;
    o.y = a.y + (b.y - a.y) * tt;
    o.r = a.r + (b.r - a.r) * tt;
    if (a.n === b.n) {
      for (let m = 0; m < b.n * 2; m++) o.pts[m] = a.pts[m] + (b.pts[m] - a.pts[m]) * tt;
    }
  }
  if (ff >= 1) return;
  for (let j = 0; j < prev.n; j++) {
    const p = prev.ops[j];
    if (p.k === "") continue;
    let found = false;
    for (let i = 0; i < next.n; i++) {
      if (next.ops[i].k === p.k && next.ops[i].kind === p.kind) {
        found = true;
        break;
      }
    }
    if (found) continue;
    const o = out.push(p.k, p.kind);
    copyOp(o, p);
    o.alpha *= 1 - ff;
    o.fillAlpha *= 1 - ff;
  }
}

// ── grids (obstacles / depth) ─────────────────────────────────────────────

export interface CellOptions {
  /** Cells farther than this are not drawn (5 m obstacles; depth 2 or 5 m). */
  maxM: number;
  /** At or nearer than this a cell is red, else amber. */
  nearM: number;
  /** `solid` fills measured cells; `outline` only strokes. */
  mode: "solid" | "outline";
  /** Unscaled depth: every cell is drawn outlined. */
  unscaled?: boolean;
}

/**
 * Lay out a `cols`×`rows` grid of log-coded distances over `rect`. Unknown
 * cells (code 0) are never drawn; a cell nearer than `maxM` is filled when
 * measured (bit set in `measured`, LSB first) and solid mode, else outlined.
 */
export function layoutCells(
  near: Uint8Array,
  measured: Uint8Array | null,
  cols: number,
  rows: number,
  rect: Rect,
  opts: CellOptions,
  out: DrawOpBuffer,
): void {
  const maxCode = gridCodeFor(opts.maxM);
  const cw = rect.w / cols;
  const ch = rect.h / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const v = near[i];
      if (v === 0 || v > maxCode) continue;
      const d = decodeGridCode(v) ?? Infinity;
      if (d > opts.maxM) continue;
      const isMeasured = measured ? ((measured[i >> 3] >> (i & 7)) & 1) === 1 : false;
      const solid = opts.mode === "solid" && isMeasured && !opts.unscaled;
      const red = d <= opts.nearM;
      const op = out.push("", "rect");
      op.x = rect.x + c * cw;
      op.y = rect.y + r * ch;
      op.w = cw;
      op.h = ch;
      op.color = red ? LAYER_COLORS.near : LAYER_COLORS.mid;
      op.width = 1;
      op.halo = false;
      op.alpha = solid ? 0 : 0.8;
      op.fill = solid ? op.color : null;
      op.fillAlpha = red ? 0.45 : 0.3;
    }
  }
}

/** Nearest finite sector distance, or null. */
export function nearestSector(sectorsM: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const s of sectorsM) if (s !== null && (best === null || s < best)) best = s;
  return best;
}

/**
 * The bottom-centre obstacle strip: the front 180° of the 72 sectors as arc
 * segments (red ≤ nearM, amber ≤ maxM, nothing beyond), plus the nearest
 * distance label when anything is within `maxM`.
 */
export function layoutSectorArc(
  sectorsM: readonly (number | null)[],
  rect: Rect,
  opts: { maxM: number; nearM: number },
  out: DrawOpBuffer,
): void {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h - 12;
  const rad = Math.min(rect.w, rect.h) * 0.16;
  let nearest: number | null = null;
  for (let s = -18; s < 18; s++) {
    const d = sectorsM[(s + 72) % 72];
    if (d === null || d === undefined || d > opts.maxM) continue;
    if (nearest === null || d < nearest) nearest = d;
    // Sector s spans [s·5°, (s+1)·5°] clockwise from the nose; nose is up.
    const op = out.push("", "line");
    op.color = d <= opts.nearM ? LAYER_COLORS.near : LAYER_COLORS.mid;
    op.width = 5;
    for (let q = 0; q <= 2; q++) {
      const a = ((s * 5 + q * 2.5) * Math.PI) / 180 - Math.PI / 2;
      DrawOpBuffer.addPt(op, cx + rad * Math.cos(a), cy + rad * Math.sin(a));
    }
  }
  if (nearest !== null) {
    const op = out.push("obst:nearest", "chip");
    op.x = cx;
    op.y = cy - rad - 14;
    op.text = `${nearest.toFixed(1)} m`;
    op.color = nearest <= opts.nearM ? LAYER_COLORS.near : LAYER_COLORS.mid;
  }
}

/** Landing-zone candidates: green dashed polygons with a score chip. */
export function layoutZones(zones: readonly SurfaceZone[], rect: Rect, out: DrawOpBuffer): void {
  for (let z = 0; z < zones.length; z++) {
    const zone = zones[z];
    const op = out.push("", "poly");
    op.color = LAYER_COLORS.zone;
    op.width = 2;
    op.dash = 6;
    op.closed = true;
    op.fill = LAYER_COLORS.zone;
    op.fillAlpha = 0.12;
    let sx = 0;
    let sy = 0;
    for (const [x, y] of zone.pts) {
      const px = rect.x + x * rect.w;
      const py = rect.y + y * rect.h;
      DrawOpBuffer.addPt(op, px, py);
      sx += px;
      sy += py;
    }
    const chip = out.push("", "chip");
    chip.x = sx / zone.pts.length;
    chip.y = sy / zone.pts.length;
    chip.text = `${Math.round(zone.score * 100)}`;
    chip.color = LAYER_COLORS.zone;
  }
}
