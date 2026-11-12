/**
 * @module hud/layer-paint
 * @description The painter for the cockpit layer draw list (`layer-layout`):
 * strokes, fills and text chips of a `DrawOpBuffer`, each with its halo.
 * Mission Control keeps the shared `layer-layout` painter in this file of its
 * own so both stay within the source size limit.
 *
 * @license GPL-3.0-only
 */

import { HALO_ALPHA, HALO_PX, LAYER_COLORS, type DrawOp, type DrawOpBuffer } from "./layer-layout";

const textWidths = new Map<string, number>();
const LABEL_FONT = "600 12px Inter, system-ui, sans-serif";
/** Dash patterns reused on every paint (`setLineDash` copies its argument). */
const DASH = [0, 0];
const SOLID: number[] = [];
/** An edge chip's dark plate stays at this alpha however dimmed the chip is,
 *  and its text never fades below `CHIP_TEXT_MIN_ALPHA`: a dimmed chip stays
 *  legible on bright video and shows its dimming in the paused grey instead. */
export const CHIP_PLATE_ALPHA = 0.72;
export const CHIP_TEXT_MIN_ALPHA = 0.85;

function measure(ctx: CanvasRenderingContext2D, text: string): number {
  let w = textWidths.get(text);
  if (w === undefined) {
    w = ctx.measureText(text).width;
    if (textWidths.size > 512) textWidths.clear();
    textWidths.set(text, w);
  }
  return w;
}

function tracePath(ctx: CanvasRenderingContext2D, op: DrawOp): void {
  ctx.beginPath();
  switch (op.kind) {
    case "line":
    case "poly":
      for (let i = 0; i < op.n; i++) {
        const x = op.pts[i * 2];
        const y = op.pts[i * 2 + 1];
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (op.closed) ctx.closePath();
      break;
    case "rect":
      ctx.rect(op.x, op.y, op.w, op.h);
      break;
    case "circle":
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      break;
    case "tri":
      ctx.moveTo(op.x, op.y);
      ctx.lineTo(op.x - op.r / 2, op.y - op.r);
      ctx.lineTo(op.x + op.r / 2, op.y - op.r);
      ctx.closePath();
      break;
    case "arrow": {
      const c = Math.cos(op.ang);
      const s = Math.sin(op.ang);
      const r = op.r;
      ctx.moveTo(op.x + c * r, op.y + s * r);
      ctx.lineTo(op.x - c * r * 0.6 - s * r * 0.6, op.y - s * r * 0.6 + c * r * 0.6);
      ctx.lineTo(op.x - c * r * 0.2, op.y - s * r * 0.2);
      ctx.lineTo(op.x - c * r * 0.6 + s * r * 0.6, op.y - s * r * 0.6 - c * r * 0.6);
      ctx.closePath();
      break;
    }
    case "chevron": {
      const c = Math.cos(op.ang);
      const s = Math.sin(op.ang);
      const r = op.r;
      ctx.moveTo(op.x - c * r - s * r, op.y - s * r + c * r);
      ctx.lineTo(op.x, op.y);
      ctx.lineTo(op.x - c * r + s * r, op.y - s * r - c * r);
      break;
    }
    case "fpv":
      ctx.moveTo(op.x + op.r, op.y);
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.moveTo(op.x - op.r, op.y);
      ctx.lineTo(op.x - op.r * 2, op.y);
      ctx.moveTo(op.x + op.r, op.y);
      ctx.lineTo(op.x + op.r * 2, op.y);
      ctx.moveTo(op.x, op.y - op.r);
      ctx.lineTo(op.x, op.y - op.r * 1.6);
      break;
    case "cross":
      ctx.moveTo(op.x - op.r, op.y - op.r);
      ctx.lineTo(op.x + op.r, op.y + op.r);
      ctx.moveTo(op.x + op.r, op.y - op.r);
      ctx.lineTo(op.x - op.r, op.y + op.r);
      break;
    case "pad":
      ctx.arc(op.x, op.y, op.r, 0, Math.PI * 2);
      ctx.moveTo(op.x - op.r * 0.4, op.y - op.r * 0.5);
      ctx.lineTo(op.x - op.r * 0.4, op.y + op.r * 0.5);
      ctx.moveTo(op.x + op.r * 0.4, op.y - op.r * 0.5);
      ctx.lineTo(op.x + op.r * 0.4, op.y + op.r * 0.5);
      ctx.moveTo(op.x - op.r * 0.4, op.y);
      ctx.lineTo(op.x + op.r * 0.4, op.y);
      break;
    default:
      break;
  }
}

/**
 * Paint `buf` onto `ctx` (already scaled to CSS px). Every stroke and glyph
 * gets a HALO_PX halo unless `op.halo` is false. `alphaScale` dims the whole
 * buffer (a stale layer).
 */
export function paintOps(ctx: CanvasRenderingContext2D, buf: DrawOpBuffer, alphaScale = 1): void {
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.font = LABEL_FONT;
  ctx.textBaseline = "middle";
  for (let i = 0; i < buf.n; i++) {
    const op = buf.ops[i];
    const a = op.alpha * alphaScale;
    const fa = op.fillAlpha * alphaScale;
    if (a <= 0.001 && (op.fill === null || fa <= 0.001)) continue;
    if (op.kind === "chip" || op.kind === "text") {
      const w = measure(ctx, op.text);
      const left = op.align === "left" ? op.x : op.align === "right" ? op.x - w : op.x - w / 2;
      if (op.kind === "chip") {
        ctx.globalAlpha = CHIP_PLATE_ALPHA;
        ctx.fillStyle = LAYER_COLORS.halo;
        ctx.beginPath();
        ctx.roundRect(left - 6, op.y - 10, w + 12, 20, 6);
        ctx.fill();
      } else {
        ctx.globalAlpha = HALO_ALPHA * a;
        ctx.strokeStyle = LAYER_COLORS.halo;
        ctx.lineWidth = HALO_PX * 2;
        ctx.strokeText(op.text, left, op.y);
      }
      const dimChip = op.kind === "chip" && a < CHIP_TEXT_MIN_ALPHA;
      ctx.globalAlpha = op.kind === "chip" ? Math.max(a, CHIP_TEXT_MIN_ALPHA) : a;
      ctx.fillStyle = dimChip ? LAYER_COLORS.paused : op.color;
      ctx.fillText(op.text, left, op.y);
      continue;
    }
    tracePath(ctx, op);
    if (op.fill !== null && fa > 0) {
      ctx.globalAlpha = fa;
      ctx.fillStyle = op.fill;
      ctx.fill();
    }
    if (a <= 0.001) continue;
    if (op.dash > 0) {
      DASH[0] = op.dash;
      DASH[1] = op.dash * 0.8;
      ctx.setLineDash(DASH);
    } else {
      ctx.setLineDash(SOLID);
    }
    if (op.halo) {
      ctx.globalAlpha = HALO_ALPHA * a;
      ctx.strokeStyle = LAYER_COLORS.halo;
      ctx.lineWidth = op.width + HALO_PX * 2;
      ctx.stroke();
    }
    ctx.globalAlpha = a;
    ctx.strokeStyle = op.color;
    ctx.lineWidth = op.width;
    ctx.stroke();
  }
  ctx.setLineDash(SOLID);
  ctx.globalAlpha = 1;
}
