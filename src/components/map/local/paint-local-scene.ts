/**
 * @module map/local/paint-local-scene
 * @description Strokes a {@link LocalScene} onto a 2D canvas. Every position
 * comes from the scene; this file only owns line widths, dash patterns and
 * the order of the layers. Colours are the resolved `--hud-*` values; the
 * pilot's planned path takes `tokens.json` `state.goto`, `state.blocked`
 * while the pilot reports blocked.
 *
 * @license GPL-3.0-only
 */

import tokens from "@/lib/cockpit-spec/tokens.json";
import type { LocalScene } from "@/lib/hud/local-scene";

export interface LocalSceneColours {
  ink: string;
  primary: string;
  track: string;
  coast: string;
  hair: string;
  muted: string;
  glass: string;
  mono: string;
}

/** The CSS custom properties the painter reads. */
export const LOCAL_SCENE_VARS: Record<keyof LocalSceneColours, string> = {
  ink: "--hud-ink",
  primary: "--hud-primary",
  track: "--hud-track",
  coast: "--hud-coast",
  hair: "--hud-hair",
  muted: "--hud-muted",
  glass: "--hud-glass-strong",
  mono: "--mono",
};

const DIAMOND_HALF_PX = 5;
const ARROW_PX = 7;
const GOAL_RING_PX = 5;
const PLAN_DASH: number[] = [5, 4];

/** The pilot's planned path, dashed, and a ring on its goal. */
export function paintPlan(ctx: CanvasRenderingContext2D, plan: NonNullable<LocalScene["plan"]>, c: LocalSceneColours): void {
  const colour = plan.blocked ? tokens.state.blocked : tokens.state.goto;
  const strokeBoth = () => {
    // A dark halo under the colour keeps it legible on tiles.
    ctx.strokeStyle = c.glass;
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  };
  ctx.lineJoin = "round";
  if (plan.points.length >= 2) {
    ctx.setLineDash(PLAN_DASH);
    ctx.beginPath();
    ctx.moveTo(plan.points[0][0], plan.points[0][1]);
    for (let i = 1; i < plan.points.length; i++) ctx.lineTo(plan.points[i][0], plan.points[i][1]);
    strokeBoth();
    ctx.setLineDash([]);
  }
  if (plan.goal) {
    ctx.beginPath();
    ctx.arc(plan.goal[0], plan.goal[1], GOAL_RING_PX, 0, Math.PI * 2);
    strokeBoth();
  }
}

function paintTarget(ctx: CanvasRenderingContext2D, t: NonNullable<LocalScene["target"]>, c: LocalSceneColours): void {
  const colour = t.dashed ? c.coast : c.track;
  ctx.setLineDash(t.dashed ? [3, 2] : []);
  if (t.tickX !== null && t.tickY !== null) {
    ctx.strokeStyle = colour;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(t.sx, t.sy);
    ctx.lineTo(t.tickX, t.tickY);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(t.sx, t.sy - DIAMOND_HALF_PX);
  ctx.lineTo(t.sx + DIAMOND_HALF_PX, t.sy);
  ctx.lineTo(t.sx, t.sy + DIAMOND_HALF_PX);
  ctx.lineTo(t.sx - DIAMOND_HALF_PX, t.sy);
  ctx.closePath();
  // Outlined stroke: a dark halo under the colour keeps it legible on tiles.
  ctx.strokeStyle = c.glass;
  ctx.lineWidth = 3.5;
  ctx.stroke();
  ctx.strokeStyle = colour;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintDrone(ctx: CanvasRenderingContext2D, d: NonNullable<LocalScene["drone"]>, c: LocalSceneColours): void {
  ctx.save();
  ctx.translate(d.sx, d.sy);
  ctx.rotate((d.yawDeg * Math.PI) / 180);
  ctx.beginPath();
  ctx.moveTo(0, -ARROW_PX);
  ctx.lineTo(ARROW_PX * 0.7, ARROW_PX);
  ctx.lineTo(0, ARROW_PX * 0.45);
  ctx.lineTo(-ARROW_PX * 0.7, ARROW_PX);
  ctx.closePath();
  ctx.fillStyle = c.primary;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = 1;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function paintLocalScene(
  ctx: CanvasRenderingContext2D,
  scene: LocalScene,
  size: { width: number; height: number },
  colours: LocalSceneColours,
  tile: (key: string) => CanvasImageSource | null,
  originLabel: string,
): void {
  const { width, height } = size;
  ctx.clearRect(0, 0, width, height);
  ctx.globalAlpha = 1;
  ctx.setLineDash([]);

  ctx.strokeStyle = colours.hair;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const g of scene.grid) {
    ctx.moveTo(Math.round(g.x1) + 0.5, Math.round(g.y1) + 0.5);
    ctx.lineTo(Math.round(g.x2) + 0.5, Math.round(g.y2) + 0.5);
  }
  ctx.stroke();

  ctx.imageSmoothingEnabled = false;
  for (const t of scene.tiles) {
    const img = tile(t.key);
    if (img) ctx.drawImage(img, t.sx, t.sy, t.sizePx, t.sizePx);
  }

  if (scene.dim) {
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = colours.glass;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
  }

  ctx.strokeStyle = colours.primary;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  for (const run of scene.trail) {
    if (run.points.length < 2) continue;
    ctx.setLineDash(run.dashed ? [4, 3] : []);
    ctx.beginPath();
    ctx.moveTo(run.points[0][0], run.points[0][1]);
    for (let i = 1; i < run.points.length; i++) ctx.lineTo(run.points[i][0], run.points[i][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  ctx.globalAlpha = 0.6;
  ctx.fillStyle = colours.ink;
  for (const [x, y] of scene.scan) ctx.fillRect(x - 0.5, y - 0.5, 1, 1);
  ctx.globalAlpha = 1;

  const { sx: ox, sy: oy } = scene.origin;
  ctx.strokeStyle = colours.muted;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(ox - 5, oy);
  ctx.lineTo(ox + 5, oy);
  ctx.moveTo(ox, oy - 5);
  ctx.lineTo(ox, oy + 5);
  ctx.stroke();
  ctx.fillStyle = colours.muted;
  ctx.font = `9px ${colours.mono}`;
  ctx.fillText(originLabel, ox + 7, oy - 3);

  if (scene.plan) paintPlan(ctx, scene.plan, colours);
  if (scene.target) paintTarget(ctx, scene.target, colours);
  if (scene.drone) paintDrone(ctx, scene.drone, colours);
}
