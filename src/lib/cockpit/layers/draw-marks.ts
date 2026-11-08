/**
 * @module cockpit/layers/draw-marks
 * @description The composited cockpit marks of the `targets` layer (plugin and
 * built-in reticles, boxes, points, polylines, labels), letterbox-mapped into
 * the layer canvas. Drawn by {@link drawTargets} after the target glyphs.
 *
 * @license GPL-3.0-only
 */

import { mapPoint, mapScale, type CockpitMark, type MarkFrame } from "@/lib/cockpit/marks";
import type { TargetStyle } from "./draw-targets";

/** Corner-bracket length as a fraction of the shorter box side. */
const BRACKET_FRAC = 0.28;
const BRACKET_MIN = 8;
const BRACKET_MAX = 22;
const MARK_ACCENT = "#63b3ff";
/** A dashed box mark uses the target layer's coast dash. */
const DASH_BOX = [4, 3];

/** The composited cockpit marks, letterbox-mapped through `frame`. `cw`/`ch`
 * are the frame's container size (normalised marks map into it). */
export function drawMarks(
  ctx: CanvasRenderingContext2D,
  marks: readonly CockpitMark[],
  frame: MarkFrame | null,
  s: TargetStyle,
  cw: number,
  ch: number,
): void {
  if (marks.length === 0) return;
  for (const m of marks) {
    const space = m.space ?? "frame";
    const color = m.color === "var(--hud-lead)" ? s.lead : (m.color ?? MARK_ACCENT);
    ctx.save();
    switch (m.kind) {
      case "box":
      case "reticle": {
        const p = mapPoint(m.x, m.y, space, cw, ch, frame);
        if (!p) break;
        const w = mapScale(m.width, "x", space, cw, ch, frame);
        const h = mapScale(m.height, "y", space, cw, ch, frame);
        ctx.strokeStyle = color;
        if (m.kind === "box") {
          ctx.lineWidth = 1.5;
          if (m.dashed) ctx.setLineDash(DASH_BOX);
          ctx.strokeRect(p.x, p.y, w, h);
          break;
        }
        const b = Math.max(BRACKET_MIN, Math.min(BRACKET_MAX, Math.min(w, h) * BRACKET_FRAC));
        const r = p.x + w;
        const bot = p.y + h;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y + b);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(p.x + b, p.y);
        ctx.moveTo(r - b, p.y);
        ctx.lineTo(r, p.y);
        ctx.lineTo(r, p.y + b);
        ctx.moveTo(p.x, bot - b);
        ctx.lineTo(p.x, bot);
        ctx.lineTo(p.x + b, bot);
        ctx.moveTo(r - b, bot);
        ctx.lineTo(r, bot);
        ctx.lineTo(r, bot - b);
        ctx.stroke();
        break;
      }
      case "point": {
        const p = mapPoint(m.x, m.y, space, cw, ch, frame);
        if (!p) break;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, m.radius ?? 4, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case "polyline": {
        ctx.strokeStyle = color;
        ctx.lineWidth = m.width ?? 2;
        ctx.beginPath();
        let ok = true;
        for (let i = 0; i < m.points.length; i++) {
          const p = mapPoint(m.points[i][0], m.points[i][1], space, cw, ch, frame);
          if (!p) {
            ok = false;
            break;
          }
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        if (ok) ctx.stroke();
        break;
      }
      case "label": {
        const p = mapPoint(m.x, m.y, space, cw, ch, frame);
        if (!p) break;
        ctx.fillStyle = color;
        ctx.font = "11px monospace";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(m.text, p.x, p.y);
        break;
      }
    }
    ctx.restore();
  }
}
