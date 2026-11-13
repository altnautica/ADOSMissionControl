/**
 * @module hud/local-scene
 * @description Builds the draw list for the local-frame map (cockpit minimap
 * local mode and the node-detail Map tab). Pure: every coordinate here is a
 * screen pixel from `mapToScreen`; the canvas painter only strokes and fills
 * what this returns, back to front: grid, occupancy, dim, trail, scan,
 * origin, planned path and goal, target, drone.
 *
 * @license GPL-3.0-only
 */

import {
  LOCAL_ZOOM_MAX,
  LOCAL_ZOOM_MIN,
  mapToScreen,
  scaleBarStep,
  tileFootprint,
  trailRuns,
  type LocalView,
  type OccupancyGrid,
  type TrailPoint,
} from "./local-frame";
import type { PilotState } from "./cockpit-frames";

/** The view recentres on the drone this long after the last pan. */
export const RECENTRE_AFTER_MS = 10_000;
export const DEFAULT_LOCAL_ZOOM = 10;

export interface LocalSceneTarget {
  north: number;
  east: number;
  /** m/s; the tick shows 1 s of travel. */
  velNorth: number | null;
  velEast: number | null;
  /** Coasting / searching: dashed in the coast colour. */
  dashed: boolean;
}

export interface LocalSceneDrone {
  north: number;
  east: number;
  /** Heading, degrees clockwise from north. */
  yawDeg: number;
}

/** The pilot's planned path (`plan_ned`, drone to goal) and goal while a
 *  go-to or a skill flies, in map NED metres; `blocked` from the pilot's
 *  avoid state. */
export interface LocalScenePlan {
  points: ReadonlyArray<readonly [number, number]>;
  goal: readonly [number, number] | null;
  blocked: boolean;
}

/** The plan a pilot frame reports, or null when it reports none. The caller
 *  passes null for a stale frame. */
export function localPlan(pilot: Pick<PilotState, "planNed" | "goalNed" | "avoidState"> | null): LocalScenePlan | null {
  if (!pilot || (pilot.planNed.length === 0 && !pilot.goalNed)) return null;
  return {
    points: pilot.planNed,
    goal: pilot.goalNed ? [pilot.goalNed[0], pilot.goalNed[1]] : null,
    blocked: pilot.avoidState === "blocked",
  };
}

export interface LocalSceneInput {
  width: number;
  height: number;
  view: LocalView;
  occupancy: OccupancyGrid;
  /** The last occupancy poll is older than the dim threshold. */
  occupancyStale: boolean;
  trail: readonly TrailPoint[];
  /** Scan returns in the map frame, or null when the scan or pose is stale. */
  scanPoints: ReadonlyArray<readonly [number, number]> | null;
  target: LocalSceneTarget | null;
  drone: LocalSceneDrone | null;
  /** The pilot's plan, or null while nothing planned flies or the pilot
   *  frame is stale. */
  plan: LocalScenePlan | null;
}

export interface LocalSceneTile {
  key: string;
  sx: number;
  sy: number;
  sizePx: number;
}

export interface LocalScene {
  gridStepM: number;
  grid: Array<{ x1: number; y1: number; x2: number; y2: number }>;
  tiles: LocalSceneTile[];
  dim: boolean;
  trail: Array<{ points: Array<[number, number]>; dashed: boolean }>;
  scan: Array<[number, number]>;
  origin: { sx: number; sy: number };
  plan: { points: Array<[number, number]>; goal: [number, number] | null; blocked: boolean } | null;
  target: { sx: number; sy: number; tickX: number | null; tickY: number | null; dashed: boolean } | null;
  drone: { sx: number; sy: number; yawDeg: number } | null;
  scaleBar: { m: number; px: number };
}

export function clampZoom(pxPerM: number): number {
  return Math.min(LOCAL_ZOOM_MAX, Math.max(LOCAL_ZOOM_MIN, pxPerM));
}

/** One `+` / `−` button step. */
export function stepZoom(pxPerM: number, dir: 1 | -1): number {
  return clampZoom(dir > 0 ? pxPerM * 1.25 : pxPerM / 1.25);
}

/** Wheel zoom: a smooth factor per wheel delta (negative delta zooms in). */
export function wheelZoom(pxPerM: number, deltaY: number): number {
  return clampZoom(pxPerM * Math.exp(-deltaY * 0.0015));
}

/**
 * The map point at the view centre: the operator's pan while it is younger
 * than {@link RECENTRE_AFTER_MS}, else the drone, else the origin.
 */
export function viewCentre(
  pan: { north: number; east: number; at: number } | null,
  drone: { north: number; east: number } | null,
  now: number,
): { north: number; east: number } {
  if (pan && now - pan.at < RECENTRE_AFTER_MS) return { north: pan.north, east: pan.east };
  if (drone) return { north: drone.north, east: drone.east };
  return { north: 0, east: 0 };
}

function gridLines(input: LocalSceneInput, stepM: number): LocalScene["grid"] {
  const { view, width, height } = input;
  const halfN = height / 2 / view.pxPerM;
  const halfE = width / 2 / view.pxPerM;
  const out: LocalScene["grid"] = [];
  for (let k = Math.ceil((view.centreX - halfN) / stepM); k * stepM <= view.centreX + halfN; k++) {
    const { sy } = mapToScreen(view, k * stepM, view.centreY);
    out.push({ x1: 0, y1: sy, x2: width, y2: sy });
  }
  for (let k = Math.ceil((view.centreY - halfE) / stepM); k * stepM <= view.centreY + halfE; k++) {
    const { sx } = mapToScreen(view, view.centreX, k * stepM);
    out.push({ x1: sx, y1: 0, x2: sx, y2: height });
  }
  return out;
}

function sceneTiles(input: LocalSceneInput): LocalSceneTile[] {
  const { occupancy, view, width, height } = input;
  if (occupancy.resM === null || occupancy.tileCells === null) return [];
  const out: LocalSceneTile[] = [];
  for (const [key, t] of Object.entries(occupancy.tiles)) {
    const fp = tileFootprint(t.ix, t.iy, occupancy.resM, occupancy.tileCells);
    const { sx, sy } = mapToScreen(view, fp.anchorX, fp.anchorY);
    const sizePx = fp.sizeM * view.pxPerM;
    if (sx > width || sy > height || sx + sizePx < 0 || sy + sizePx < 0) continue;
    out.push({ key, sx, sy, sizePx });
  }
  return out;
}

export function buildLocalScene(input: LocalSceneInput): LocalScene {
  const { view, width, height } = input;
  const gridStepM = scaleBarStep(view.pxPerM);
  const project = (n: number, e: number): [number, number] => {
    const p = mapToScreen(view, n, e);
    return [p.sx, p.sy];
  };

  const scan: Array<[number, number]> = [];
  for (const [n, e] of input.scanPoints ?? []) {
    const [sx, sy] = project(n, e);
    if (sx >= 0 && sy >= 0 && sx <= width && sy <= height) scan.push([sx, sy]);
  }

  let target: LocalScene["target"] = null;
  if (input.target) {
    const t = input.target;
    const [sx, sy] = project(t.north, t.east);
    let tickX: number | null = null;
    let tickY: number | null = null;
    if (t.velNorth !== null && t.velEast !== null) {
      [tickX, tickY] = project(t.north + t.velNorth, t.east + t.velEast);
    }
    target = { sx, sy, tickX, tickY, dashed: t.dashed };
  }

  const plan: LocalScene["plan"] = input.plan
    ? {
        points: input.plan.points.map(([n, e]) => project(n, e)),
        goal: input.plan.goal ? project(input.plan.goal[0], input.plan.goal[1]) : null,
        blocked: input.plan.blocked,
      }
    : null;

  let drone: LocalScene["drone"] = null;
  if (input.drone) {
    const [sx, sy] = project(input.drone.north, input.drone.east);
    drone = { sx, sy, yawDeg: input.drone.yawDeg };
  }

  const [ox, oy] = project(0, 0);
  return {
    gridStepM,
    grid: gridLines(input, gridStepM),
    tiles: sceneTiles(input),
    dim: input.occupancyStale,
    trail: trailRuns(input.trail).map((run) => ({
      points: run.points.map((p) => project(p.x, p.y)),
      dashed: run.dashed,
    })),
    scan,
    origin: { sx: ox, sy: oy },
    target,
    plan,
    drone,
    scaleBar: { m: gridStepM, px: gridStepM * view.pxPerM },
  };
}
