/**
 * @module hud-draw-status
 * @description Status drawing (battery bar, GPS/mode, armed status, signal bars, flight timer).
 * @license GPL-3.0-only
 */

import {
  HUD_INK, ARMED_RED, DISARMED_GREEN, SHADOW, FONT,
  NO_DATA_INK, NO_DATA_GLYPH,
  batColor, formatTimerFromMs, setHudStyle, clearShadow,
} from "./hud-draw";

export function drawBatteryHud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  pct: number | null
) {
  const barW = 200;
  const barH = 10;
  const left = cx - barW / 2;

  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(left, y, barW, barH);

  // A stale / absent battery reading draws an empty bar + "\u2014" rather than a
  // fabricated 0% that reads as a real (critical) level.
  if (pct !== null) {
    const fillW = (pct / 100) * barW;
    ctx.fillStyle = batColor(pct);
    ctx.fillRect(left, y, fillW, barH);
  }

  ctx.strokeStyle = HUD_INK;
  ctx.lineWidth = 1;
  ctx.strokeRect(left, y, barW, barH);

  setHudStyle(ctx, "#ffffff", 10, "center", "top");
  ctx.fillText(pct !== null ? `${Math.round(pct)}%` : "\u2014", cx, y + barH + 3);
  clearShadow(ctx);
}

/**
 * Satellite count + flight mode. A null mode renders the no-data glyph: the
 * mode label is a claim about what the aircraft is doing, and the last mode
 * heard from a link that has since gone silent is not that claim.
 */
export function drawGpsAndMode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  satellites: number | null,
  mode: string | null
) {
  setHudStyle(ctx, HUD_INK, 11, "left", "bottom");
  ctx.fillText(`\u2736 ${satellites !== null ? satellites : NO_DATA_GLYPH} SAT`, x, y);
  clearShadow(ctx);
  setHudStyle(ctx, mode !== null ? HUD_INK : NO_DATA_INK, 11, "left", "bottom");
  ctx.fillText(mode !== null ? mode : NO_DATA_GLYPH, x, y + 16);
  clearShadow(ctx);
}

export function drawArmedStatus(
  ctx: CanvasRenderingContext2D,
  cx: number,
  y: number,
  armed: boolean | null
) {
  // A null arm state (no live heartbeat) shows "\u2014" instead of a stale
  // "DISARMED" that reads as a confirmed safe state.
  const text = armed === null ? "\u2014" : armed ? "ARMED" : "DISARMED";
  const color = armed === null ? HUD_INK : armed ? ARMED_RED : DISARMED_GREEN;

  setHudStyle(ctx, color, 12, "center", "top");
  ctx.font = `bold 12px ${FONT}`;
  ctx.fillText(text, cx, y);
  clearShadow(ctx);
}

/**
 * Radio-link strength meter. `bars` is a real measurement or null — it was once
 * the literal 4, which drew a full-strength link on a dead radio and on a node
 * with no radio at all. Null draws every bar unlit plus the no-data glyph, so
 * "not measured" is visibly different from a measured zero.
 */
export function drawSignalBars(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  bars: number | null
) {
  const barW = 3;
  const gap = 2;
  const maxH = 12;
  const count = 4;

  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 1;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  for (let i = 0; i < count; i++) {
    const bh = ((i + 1) / count) * maxH;
    const bx = x + i * (barW + gap);
    const by = y - bh;
    ctx.fillStyle =
      bars !== null && i < bars ? HUD_INK : "rgba(255,255,255,0.2)";
    ctx.fillRect(bx, by, barW, bh);
  }
  clearShadow(ctx);

  if (bars === null) {
    const meterW = count * barW + (count - 1) * gap;
    setHudStyle(ctx, NO_DATA_INK, 10, "center", "bottom");
    ctx.fillText(NO_DATA_GLYPH, x + meterW / 2, y - maxH - 2);
    clearShadow(ctx);
  }
}

export function drawFlightTimer(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  startedAt: number | undefined
) {
  const elapsed = startedAt ? Date.now() - startedAt : 0;
  setHudStyle(ctx, HUD_INK, 11, "right", "bottom");
  ctx.fillText(formatTimerFromMs(elapsed), x, y);
  clearShadow(ctx);
}
