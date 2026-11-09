/**
 * @module hud/local-frame
 * @description Pure geometry for the minimap's local frame: occupancy tile
 * placement and merging, map → screen projection, scan → map transform, the
 * SLAM trail and the scale bar. All local layers live in the map frame
 * (x north, y east, metres). Screen axes are north-up: screen up = +x,
 * screen right = +y.
 *
 * @license GPL-3.0-only
 */

import type { NavHealth, NavPose, NavScan, OccupancyLive } from "./nav-types";

// ── occupancy tiles ──────────────────────────────────────────────────

/** Maximum tiles kept per drone (decoded bitmaps are cached per tile). */
export const OCCUPANCY_TILE_LIMIT = 512;

export interface OccupancyTile {
  ix: number;
  iy: number;
  pngB64: string;
  /** Sequence of the poll that last changed this tile. */
  seq: number;
}

export interface OccupancyGrid {
  /** Last `seq` returned by the agent; the next poll asks `since` this. */
  seq: number;
  resM: number | null;
  tileCells: number | null;
  /** Tiles keyed `ix,iy`, least recently changed first. */
  tiles: Record<string, OccupancyTile>;
}

export const EMPTY_OCCUPANCY: OccupancyGrid = { seq: 0, resM: null, tileCells: null, tiles: {} };

/**
 * The map-frame footprint of tile `(ix, iy)`. The tile covers
 * x ∈ [ix·cells·res, (ix+1)·cells·res) and likewise y. PNG row 0 is max x
 * (north) and column 0 is min y (west), so the top-left screen corner is the
 * point `(x = (ix+1)·size, y = iy·size)`.
 */
export function tileFootprint(
  ix: number,
  iy: number,
  resM: number,
  tileCells: number,
): { northMin: number; northMax: number; eastMin: number; eastMax: number; anchorX: number; anchorY: number; sizeM: number } {
  const sizeM = tileCells * resM;
  return {
    northMin: ix * sizeM,
    northMax: (ix + 1) * sizeM,
    eastMin: iy * sizeM,
    eastMax: (iy + 1) * sizeM,
    anchorX: (ix + 1) * sizeM,
    anchorY: iy * sizeM,
    sizeM,
  };
}

/**
 * Merge one `map/live` response into the grid. A grid change (resolution or
 * tile size) or a sequence that ran backwards starts a new session; tiles are
 * kept by `(ix, iy)` with the newest PNG winning, and the least recently
 * changed tiles beyond {@link OCCUPANCY_TILE_LIMIT} are dropped.
 */
export function mergeOccupancy(grid: OccupancyGrid, live: OccupancyLive): OccupancyGrid {
  const gridChanged =
    live.resM !== null &&
    live.tileCells !== null &&
    grid.resM !== null &&
    (live.resM !== grid.resM || live.tileCells !== grid.tileCells);
  const restarted = live.seq < grid.seq;
  const base = gridChanged || restarted ? EMPTY_OCCUPANCY : grid;
  if (live.tiles.length === 0 && live.seq === base.seq && base.resM === (live.resM ?? base.resM)) {
    return base;
  }
  const tiles: Record<string, OccupancyTile> = { ...base.tiles };
  for (const t of live.tiles) {
    const key = `${t.ix},${t.iy}`;
    // Delete first so re-insertion moves the key to the newest position.
    delete tiles[key];
    tiles[key] = { ix: t.ix, iy: t.iy, pngB64: t.pngB64, seq: live.seq };
  }
  const keys = Object.keys(tiles);
  for (let i = 0; i < keys.length - OCCUPANCY_TILE_LIMIT; i++) delete tiles[keys[i]];
  return {
    seq: live.seq,
    resM: live.resM ?? base.resM,
    tileCells: live.tileCells ?? base.tileCells,
    tiles,
  };
}

/** Occupancy cell class from a map_server grey value: ≤ 100 occupied,
 * ≥ 230 free, anything between unknown. */
export function occupancyClass(v: number): "occupied" | "free" | "unknown" {
  if (v <= 100) return "occupied";
  if (v >= 230) return "free";
  return "unknown";
}

// ── projection ───────────────────────────────────────────────────────

export interface LocalView {
  /** Map point at the view centre. */
  centreX: number;
  centreY: number;
  pxPerM: number;
  /** Screen pixel of the view centre. */
  cx: number;
  cy: number;
}

/** Map point → screen pixel: `screen = centre + (y − yc, −(x − xc))·pxPerM`. */
export function mapToScreen(view: LocalView, x: number, y: number): { sx: number; sy: number } {
  return {
    sx: view.cx + (y - view.centreY) * view.pxPerM,
    sy: view.cy - (x - view.centreX) * view.pxPerM,
  };
}

/** Body FRD points (x forward, y right) for every return in `(0, maxRange]`. */
export function scanBodyPoints(scan: NavScan, maxRangeM = Infinity): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < scan.ranges.length; i++) {
    const r = scan.ranges[i];
    if (!(r > 0) || r > maxRangeM) continue;
    const th = scan.angleStartRad + i * scan.angleIncrementRad;
    out.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return out;
}

/** Scan returns in the map frame: `p_map = t + R·p_body` (z ignored). */
export function scanToMap(scan: NavScan, pose: NavPose): Array<[number, number]> {
  const { R, t } = pose;
  return scanBodyPoints(scan).map(([bx, by]) => [
    t[0] + R[0] * bx + R[1] * by,
    t[1] + R[3] * bx + R[4] * by,
  ]);
}

/** Heading (deg, clockwise from north) of the body x-axis in a pose. */
export function poseYawDeg(pose: NavPose): number {
  const deg = (Math.atan2(pose.R[3], pose.R[0]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

// ── SLAM trail ───────────────────────────────────────────────────────

export const TRAIL_WINDOW_MS = 120_000;
export const TRAIL_MIN_SPACING_M = 0.25;
export const TRAIL_MAX_POINTS = 600;

export interface TrailPoint {
  x: number;
  y: number;
  at: number;
  health: NavHealth | null;
}

/**
 * Append a pose to the trail: the last 120 s, decimated to ≥ 0.25 m spacing
 * and ≤ 600 points. A `lost` sample is recorded (it breaks the polyline) but
 * never decimated away, so a gap is never silently joined.
 */
export function appendTrail(trail: readonly TrailPoint[], p: TrailPoint): TrailPoint[] {
  const last = trail[trail.length - 1];
  if (
    last &&
    p.health !== "lost" &&
    last.health === p.health &&
    Math.hypot(p.x - last.x, p.y - last.y) < TRAIL_MIN_SPACING_M
  ) {
    return trail as TrailPoint[];
  }
  const cutoff = p.at - TRAIL_WINDOW_MS;
  let start = 0;
  while (start < trail.length && trail[start].at < cutoff) start++;
  const next = trail.slice(start);
  next.push(p);
  return next.length > TRAIL_MAX_POINTS ? next.slice(next.length - TRAIL_MAX_POINTS) : next;
}

type TrailRun = { points: TrailPoint[]; dashed: boolean };

/** Split a trail into drawable runs. `lost` points break the line; each run
 * is dashed when its samples were recorded while degraded. */
export function trailRuns(trail: readonly TrailPoint[]): TrailRun[] {
  const runs: TrailRun[] = [];
  let cur = null as TrailRun | null;
  for (const p of trail) {
    if (p.health === "lost") {
      cur = null;
      continue;
    }
    const dashed = p.health === "degraded";
    if (!cur || cur.dashed !== dashed) {
      // Start the new run at the previous run's last point so runs connect.
      const prev: TrailPoint | undefined = cur?.points[cur.points.length - 1];
      cur = { points: prev ? [prev] : [], dashed };
      runs.push(cur);
    }
    cur.points.push(p);
  }
  return runs.filter((r) => r.points.length >= 2);
}

// ── scale bar ────────────────────────────────────────────────────────

const SCALE_STEPS_M = [1, 2, 5, 10, 20, 50] as const;

/** The scale-bar step (m) whose length is 40–80 px at this zoom, else the
 * closest one. */
export function scaleBarStep(pxPerM: number): number {
  let best: number = SCALE_STEPS_M[0];
  let bestErr = Infinity;
  for (const s of SCALE_STEPS_M) {
    const px = s * pxPerM;
    if (px >= 40 && px <= 80) return s;
    const err = Math.min(Math.abs(px - 40), Math.abs(px - 80));
    if (err < bestErr) {
      bestErr = err;
      best = s;
    }
  }
  return best;
}

export const LOCAL_ZOOM_MIN = 2;
export const LOCAL_ZOOM_MAX = 80;
