/**
 * @module hud-draw-attitude
 * @description Attitude indicator drawing (pitch ladder, roll arc, crosshair, sky/ground).
 * @license GPL-3.0-only
 */

import { degToRad } from "@/lib/telemetry-utils";
import {
  HUD_INK, SHADOW, FONT,
  SKY_TOP, SKY_HORIZON, GROUND_HORIZON, GROUND_BOTTOM, HORIZON_LINE,
  NO_DATA_INK, NO_DATA_FIELD,
  clearShadow,
} from "./hud-draw";

/**
 * Label drawn where the horizon would be when no attitude sample backs it. A
 * level horizon on a vehicle nobody is hearing from reads as "the aircraft is
 * level", which is the single most dangerous thing this HUD could claim.
 */
const NO_ATTITUDE_LABEL = "NO ATTITUDE";

/** Flat unlit field + the no-attitude label. Never tilted: there is no angle. */
function drawNoAttitudeField(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  w: number,
  h: number,
) {
  ctx.save();
  ctx.fillStyle = NO_DATA_FIELD;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = NO_DATA_INK;
  ctx.font = `bold 13px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(NO_ATTITUDE_LABEL, cx, cy);
  ctx.restore();
}

/**
 * Draw the sky/ground gradient background that tilts with pitch and roll, or a
 * flat NO ATTITUDE field when either is unknown.
 */
export function drawSkyGround(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  pitch: number | null,
  roll: number | null
) {
  const cx = w / 2;
  const cy = h / 2;

  // No attitude, no horizon. The flat field is deliberately not a gradient
  // with a line through the middle — that is indistinguishable from level.
  if (pitch === null || roll === null) {
    drawNoAttitudeField(ctx, cx, cy, w, h);
    return;
  }

  const ladderH = h * 0.4;
  const pxPerDeg = ladderH / 40;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-degToRad(roll));

  const pitchOffset = pitch * pxPerDeg;
  const gradH = h * 2;
  const gradientOffset = Math.max(0, Math.min(1, 0.5 + pitchOffset / gradH));

  const grad = ctx.createLinearGradient(0, -gradH / 2, 0, gradH / 2);
  grad.addColorStop(0, SKY_TOP);
  grad.addColorStop(Math.max(0, gradientOffset - 0.001), SKY_HORIZON);
  grad.addColorStop(gradientOffset, GROUND_HORIZON);
  grad.addColorStop(1, GROUND_BOTTOM);

  ctx.fillStyle = grad;
  const diag = Math.sqrt(w * w + h * h);
  ctx.fillRect(-diag, -diag, diag * 2, diag * 2);

  ctx.strokeStyle = HORIZON_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-diag, pitchOffset);
  ctx.lineTo(diag, pitchOffset);
  ctx.stroke();

  ctx.restore();
}

export function drawCrosshair(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  const arm = 20;
  const gap = 6;
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = HUD_INK;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 2;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.moveTo(cx - arm, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + arm);
  ctx.stroke();

  ctx.fillStyle = HUD_INK;
  ctx.beginPath();
  ctx.arc(cx, cy, 2, 0, Math.PI * 2);
  ctx.fill();
  clearShadow(ctx);
}

/**
 * Pitch ladder + horizon bars. Draws the NO ATTITUDE label in place of the
 * ladder when either angle is unknown — on the transparent OSD this is the only
 * attitude cue there is, so it cannot just be skipped.
 */
export function drawPitchLadder(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  pitch: number | null, roll: number | null, h: number
) {
  if (pitch === null || roll === null) {
    ctx.save();
    ctx.fillStyle = NO_DATA_INK;
    ctx.font = `bold 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(NO_ATTITUDE_LABEL, cx, cy);
    ctx.restore();
    return;
  }

  const ladderH = h * 0.4;
  const pxPerDeg = ladderH / 40;

  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - 140, cy - ladderH / 2 - 10, 280, ladderH + 20);
  ctx.clip();
  ctx.translate(cx, cy);
  ctx.rotate(-degToRad(roll));

  ctx.lineWidth = 1;
  ctx.strokeStyle = HUD_INK;
  ctx.fillStyle = HUD_INK;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 1;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (let deg = -90; deg <= 90; deg += 5) {
    if (deg === 0) continue;
    const yOff = -(deg - pitch) * pxPerDeg;
    const halfLen = deg % 10 === 0 ? 50 : 25;
    const dashGap = 4;

    ctx.beginPath();
    if (deg > 0) {
      ctx.moveTo(-halfLen, yOff);
      ctx.lineTo(halfLen, yOff);
    } else {
      const segments = Math.floor(halfLen / (dashGap * 2));
      for (let i = 0; i < segments; i++) {
        const x0 = -halfLen + i * dashGap * 2;
        ctx.moveTo(x0, yOff); ctx.lineTo(x0 + dashGap, yOff);
      }
      for (let i = 0; i < segments; i++) {
        const x0 = dashGap + i * dashGap * 2;
        ctx.moveTo(x0, yOff); ctx.lineTo(x0 + dashGap, yOff);
      }
    }
    ctx.stroke();

    if (deg % 10 === 0) {
      ctx.fillText(String(deg), -halfLen - 16, yOff);
      ctx.fillText(String(deg), halfLen + 16, yOff);
    }
  }

  const horizonY = pitch * pxPerDeg;
  ctx.strokeStyle = HUD_INK;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-120, horizonY); ctx.lineTo(-30, horizonY);
  ctx.moveTo(30, horizonY); ctx.lineTo(120, horizonY);
  ctx.stroke();

  clearShadow(ctx);
  ctx.restore();
}

/**
 * Roll scale + pointer. Drawn only when a roll angle is known: an arc with its
 * pointer parked at 0 is a reading, and there is none.
 */
export function drawRollArc(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  roll: number | null, h: number
) {
  if (roll === null) return;

  const radius = h * 0.18;
  const arcCy = cy - h * 0.22;
  const ticks = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60];

  ctx.save();
  ctx.strokeStyle = HUD_INK;
  ctx.fillStyle = HUD_INK;
  ctx.lineWidth = 1;
  ctx.shadowColor = SHADOW;
  ctx.shadowBlur = 1;
  ctx.shadowOffsetX = 1;
  ctx.shadowOffsetY = 1;

  ctx.beginPath();
  ctx.arc(cx, arcCy + radius, radius, -Math.PI * 5 / 6, -Math.PI / 6, false);
  ctx.stroke();

  for (const t of ticks) {
    const angle = -Math.PI / 2 + degToRad(t);
    const inner = radius - (t % 30 === 0 ? 10 : 6);
    const outer = radius;
    ctx.beginPath();
    ctx.moveTo(cx + inner * Math.cos(angle), arcCy + radius + inner * Math.sin(angle));
    ctx.lineTo(cx + outer * Math.cos(angle), arcCy + radius + outer * Math.sin(angle));
    ctx.stroke();
  }

  const pAngle = -Math.PI / 2 - degToRad(roll);
  const px = cx + (radius + 5) * Math.cos(pAngle);
  const py = arcCy + radius + (radius + 5) * Math.sin(pAngle);
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(px + 5 * Math.cos(pAngle + 2.5), py + 5 * Math.sin(pAngle + 2.5));
  ctx.lineTo(px + 5 * Math.cos(pAngle - 2.5), py + 5 * Math.sin(pAngle - 2.5));
  ctx.closePath();
  ctx.fill();

  clearShadow(ctx);
  ctx.restore();
}
