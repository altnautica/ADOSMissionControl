/**
 * @module hud-draw
 * @description Shared canvas drawing functions for the HUD overlay and
 * Overview artificial horizon. Extracted from OsdOverlay.tsx so both the
 * transparent OSD (fly page) and the sky/ground HUD (overview tab) can
 * share the same instrument renderers.
 * @license GPL-3.0-only
 */

// ── Colors ──────────────────────────────────────────────────────
export const HUD_INK = "#63b3ff"; // ADOS electric-blue instrument ink
export const ARMED_RED = "#ef4444";
export const DISARMED_GREEN = "#22c55e";
export const BAT_GREEN = "#22c55e";
export const BAT_AMBER = "#f59e0b";
export const BAT_RED = "#ef4444";
export const SHADOW = "rgba(0,0,0,0.8)";
export const FONT = '"JetBrains Mono", monospace';

// ── Sky/Ground palette (Glass Cockpit) ──────────────────────────
export const SKY_TOP = "#0a1428";
export const SKY_HORIZON = "#1a4a7a";
export const GROUND_HORIZON = "#3a4a2a";
export const GROUND_BOTTOM = "#1a2510";
export const HORIZON_LINE = "rgba(255, 255, 255, 0.3)";

/**
 * Unlit instrument ink and field, used wherever a reading is unknown. Visually
 * distinct from every live colour so "no data" cannot be mistaken for a value.
 */
export const NO_DATA_INK = "rgba(255, 255, 255, 0.45)";
export const NO_DATA_FIELD = "#12161c";
export const NO_DATA_GLYPH = "\u2014";

// ── Utility ─────────────────────────────────────────────────────

export function batColor(pct: number): string {
  if (pct > 50) return BAT_GREEN;
  if (pct > 25) return BAT_AMBER;
  return BAT_RED;
}

export function formatTimerFromMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0)
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// ── Drawing helpers ─────────────────────────────────────────────

export function setHudStyle(
  ctx: CanvasRenderingContext2D,
  color: string,
  size: number,
  align: CanvasTextAlign = "center",
  baseline: CanvasTextBaseline = "middle"
) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
}

export function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

// ── Re-exports from sub-modules ─────────────────────────────────
export {
  drawSkyGround,
  drawCrosshair,
  drawPitchLadder,
  drawRollArc,
} from "./hud-draw-attitude";

export {
  drawSpeedTape,
  drawAltTape,
  drawHeadingCompass,
} from "./hud-draw-nav";

export {
  drawBatteryHud,
  drawGpsAndMode,
  drawArmedStatus,
  drawSignalBars,
  drawFlightTimer,
} from "./hud-draw-status";
