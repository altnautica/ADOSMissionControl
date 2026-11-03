/**
 * @module mock/mock-nav-world
 * @description The synthetic indoor world behind the demo navigation feed: a
 * 12 m square room with a short partition wall and three pillars, the slow
 * loop the demo drone flies through it, and a ray caster for the planar scan
 * and the FC obstacle sectors. Map frame: x north, y east, z down (metres).
 * Pure functions; no store or timer access.
 * @license GPL-3.0-only
 */

/** Half the side of the square room (m); walls sit at x, y = ±6. */
export const ROOM_HALF_M = 6;

/** Half-thickness of a wall as it appears in the occupancy grid (m). */
export const WALL_HALF_THICKNESS_M = 0.1;

/** Scan range limit (m); a ray with no hit inside it reports 0. */
export const SCAN_MAX_RANGE_M = 12;

export interface WallSegment {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface Pillar {
  x: number;
  y: number;
  r: number;
}

/** The four room walls plus a partition stub on the west side. */
export const WALLS: readonly WallSegment[] = [
  { ax: ROOM_HALF_M, ay: -ROOM_HALF_M, bx: ROOM_HALF_M, by: ROOM_HALF_M },
  { ax: -ROOM_HALF_M, ay: -ROOM_HALF_M, bx: -ROOM_HALF_M, by: ROOM_HALF_M },
  { ax: -ROOM_HALF_M, ay: ROOM_HALF_M, bx: ROOM_HALF_M, by: ROOM_HALF_M },
  { ax: -ROOM_HALF_M, ay: -ROOM_HALF_M, bx: ROOM_HALF_M, by: -ROOM_HALF_M },
  { ax: -ROOM_HALF_M, ay: -1, bx: -4.2, by: -1 },
];

export const PILLARS: readonly Pillar[] = [
  { x: 3.5, y: -3.5, r: 0.4 },
  { x: -3.6, y: 3.4, r: 0.45 },
  { x: 0.2, y: 4.6, r: 0.3 },
];

/** Loop the drone flies: an ellipse around the origin. */
export const LOOP_NORTH_M = 3;
export const LOOP_EAST_M = 2.5;
export const LOOP_PERIOD_S = 48;
export const LOOP_ALT_M = 2;

export interface LoopSample {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Heading of the body x-axis (rad, clockwise from north). */
  yawRad: number;
}

/** The drone's local-frame state on the demo loop at wall time `tSec`. */
export function demoLoopAt(tSec: number): LoopSample {
  const w = (2 * Math.PI) / LOOP_PERIOD_S;
  const th = w * tSec;
  const vx = -LOOP_NORTH_M * w * Math.sin(th);
  const vy = LOOP_EAST_M * w * Math.cos(th);
  return {
    x: LOOP_NORTH_M * Math.cos(th),
    y: LOOP_EAST_M * Math.sin(th),
    z: -(LOOP_ALT_M + 0.15 * Math.sin(0.3 * tSec)),
    vx,
    vy,
    vz: -0.045 * Math.cos(0.3 * tSec),
    yawRad: Math.atan2(vy, vx),
  };
}

/** Row-major body-FRD → map rotation for a pure yaw. */
export function yawMatrix(yawRad: number): number[] {
  const c = Math.cos(yawRad);
  const s = Math.sin(yawRad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Distance along the ray `o + t·d` (unit `d`) to the segment, or Infinity. */
function raySegment(ox: number, oy: number, dx: number, dy: number, s: WallSegment): number {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const denom = cross(dx, dy, ex, ey);
  if (Math.abs(denom) < 1e-12) return Infinity;
  const qx = s.ax - ox;
  const qy = s.ay - oy;
  const t = cross(qx, qy, ex, ey) / denom;
  const u = cross(qx, qy, dx, dy) / denom;
  return t > 1e-9 && u >= 0 && u <= 1 ? t : Infinity;
}

/** Distance along the ray (unit `d`) to the circle's near side, or Infinity. */
function rayCircle(ox: number, oy: number, dx: number, dy: number, p: Pillar): number {
  const fx = ox - p.x;
  const fy = oy - p.y;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - p.r * p.r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 1e-9 ? t : Infinity;
}

/** First hit (m) from `(x, y)` along heading `headingRad` (clockwise from
 * north), or 0 when nothing lies within `maxRangeM`. */
export function rayCast(x: number, y: number, headingRad: number, maxRangeM = SCAN_MAX_RANGE_M): number {
  const dx = Math.cos(headingRad);
  const dy = Math.sin(headingRad);
  let best = Infinity;
  for (const w of WALLS) best = Math.min(best, raySegment(x, y, dx, dy, w));
  for (const p of PILLARS) best = Math.min(best, rayCircle(x, y, dx, dy, p));
  return best <= maxRangeM ? best : 0;
}

/** A full planar scan in the body FRD frame: `count` rays clockwise from
 * forward starting at angle 0. */
export function scanRanges(x: number, y: number, yawRad: number, count = 360): number[] {
  const step = (2 * Math.PI) / count;
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) out[i] = rayCast(x, y, yawRad + i * step);
  return out;
}

/** OBSTACLE_DISTANCE sectors (cm, body FRD, clockwise from forward): the
 * nearest of three rays across each sector; `maxCm + 1` when clear. */
export function obstacleSectorsCm(
  x: number,
  y: number,
  yawRad: number,
  sectors: number,
  maxCm: number,
): number[] {
  const width = (2 * Math.PI) / sectors;
  const out: number[] = [];
  for (let k = 0; k < sectors; k++) {
    let nearest = Infinity;
    for (const f of [-0.33, 0, 0.33]) {
      const r = rayCast(x, y, yawRad + (k + f) * width, maxCm / 100);
      if (r > 0) nearest = Math.min(nearest, r);
    }
    out.push(Number.isFinite(nearest) ? Math.round(nearest * 100) : maxCm + 1);
  }
  return out;
}

/** Distance from a point to a wall segment (m). */
export function distanceToSegment(x: number, y: number, s: WallSegment): number {
  const ex = s.bx - s.ax;
  const ey = s.by - s.ay;
  const len2 = ex * ex + ey * ey;
  const u = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s.ax) * ex + (y - s.ay) * ey) / len2));
  return Math.hypot(x - (s.ax + u * ex), y - (s.ay + u * ey));
}
