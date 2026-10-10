"use client";

/**
 * @module fly/cockpit/AttitudeIndicator
 * @description The cockpit artificial horizon, drawn over the video in the HUD
 * colour: a pitch ladder with a rung every 5° (labelled every 10°, dashed
 * below the horizon), a fixed roll scale with ticks at ±10/20/30/45/60° read
 * against a sky pointer that banks with the horizon, the flight-path marker,
 * and the fixed boresight crosshair.
 *
 * Pure over its props: `HudLayer` derives the reading once per frame and
 * passes the attitude here. An absent or non-finite attitude draws no ladder,
 * no horizon and no sky pointer, only the fixed reticle and an ATT failure
 * flag, so nothing on screen can be read as "level".
 * @license GPL-3.0-only
 */

import { memo } from "react";
import type { FlightPath } from "@/lib/hud-readings";

const CX = 600;
const CY = 350;
/** Vertical pixels per degree of pitch (viewBox units). */
export const PX_PER_DEG = 6;
/** Rung spacing and label spacing of the pitch ladder, degrees. */
const RUNG_STEP_DEG = 5;
const LABEL_STEP_DEG = 10;
/** Rungs drawn either side of the current pitch (the rest are off screen). */
const LADDER_SPAN_DEG = 40;
/** Roll scale: tick angles either side of wings-level, degrees. */
const ROLL_TICKS = [10, 20, 30, 45, 60] as const;
const ROLL_R = 230;
/** Half-extent of the box the flight-path marker is kept inside. */
const FPM_MAX_DX = 420;
const FPM_MAX_DY = 250;

interface AttitudeIndicatorProps {
  pitch: number | null;
  roll: number | null;
  flightPath: FlightPath | null;
  /** Failure-flag text shown when attitude is absent. */
  attFlagLabel: string;
}

/** A point on the roll circle `deg` from the top, `r` from the centre. */
function arcPoint(deg: number, r: number): [number, number] {
  const rad = (deg * Math.PI) / 180;
  return [CX + r * Math.sin(rad), CY - r * Math.cos(rad)];
}

function rollTickLength(deg: number): number {
  if (deg === 30 || deg === 60) return 20;
  if (deg === 45) return 10;
  return 13;
}

function Ladder({ pitch }: { pitch: number }) {
  const first = Math.ceil((pitch - LADDER_SPAN_DEG) / RUNG_STEP_DEG) * RUNG_STEP_DEG;
  const last = Math.floor((pitch + LADDER_SPAN_DEG) / RUNG_STEP_DEG) * RUNG_STEP_DEG;
  const rungs = [];
  for (let deg = Math.max(first, -90); deg <= Math.min(last, 90); deg += RUNG_STEP_DEG) {
    const y = CY - deg * PX_PER_DEG;
    if (deg === 0) {
      rungs.push(
        <g key="horizon" data-rung="0" strokeWidth={1.8}>
          <line x1={330} y1={y} x2={555} y2={y} />
          <line x1={645} y1={y} x2={870} y2={y} />
        </g>,
      );
      continue;
    }
    const labelled = deg % LABEL_STEP_DEG === 0;
    const half = labelled ? 90 : 50;
    const dash = deg < 0 ? "10 7" : undefined;
    // The rung ends turn toward the horizon so its side is readable at a glance.
    const tip = deg > 0 ? 8 : -8;
    rungs.push(
      <g key={deg} data-rung={deg} strokeDasharray={dash}>
        <polyline fill="none" points={`${CX - 40 - half},${y + tip} ${CX - 40 - half},${y} ${CX - 40},${y}`} />
        <polyline fill="none" points={`${CX + 40},${y} ${CX + 40 + half},${y} ${CX + 40 + half},${y + tip}`} />
        {labelled && (
          <>
            <text x={CX - 52 - half} y={y + 4} textAnchor="end" stroke="none">
              {deg}
            </text>
            <text x={CX + 52 + half} y={y + 4} textAnchor="start" stroke="none">
              {deg}
            </text>
          </>
        )}
      </g>,
    );
  }
  return <>{rungs}</>;
}

/** Screen position of the flight-path marker, and whether it was clamped. */
function fpmPosition(
  flightPath: FlightPath,
  pitch: number,
  roll: number,
): { x: number; y: number; clamped: boolean } {
  // Earth frame: drift across, flight-path angle up, relative to the nose.
  const ex = flightPath.driftDeg * PX_PER_DEG;
  const ey = -(flightPath.gammaDeg - pitch) * PX_PER_DEG;
  // The earth frame is drawn rotated by -roll about the boresight.
  const phi = (-roll * Math.PI) / 180;
  const dx = ex * Math.cos(phi) - ey * Math.sin(phi);
  const dy = ex * Math.sin(phi) + ey * Math.cos(phi);
  const cx = Math.max(-FPM_MAX_DX, Math.min(FPM_MAX_DX, dx));
  const cy = Math.max(-FPM_MAX_DY, Math.min(FPM_MAX_DY, dy));
  return { x: CX + cx, y: CY + cy, clamped: cx !== dx || cy !== dy };
}

export const AttitudeIndicator = memo(function AttitudeIndicator({
  pitch,
  roll,
  flightPath,
  attFlagLabel,
}: AttitudeIndicatorProps) {
  const att =
    pitch !== null && roll !== null && Number.isFinite(pitch) && Number.isFinite(roll)
      ? { pitch, roll }
      : null;
  const fpm = att && flightPath ? fpmPosition(flightPath, att.pitch, att.roll) : null;

  return (
    <div className="hud" aria-hidden="true" data-testid="hud-attitude">
      <svg viewBox="0 0 1200 700" preserveAspectRatio="xMidYMid slice">
        {/* roll scale (fixed to the aircraft) */}
        <g stroke="var(--hud-primary)" strokeWidth={1.4} fill="none" opacity={0.85}>
          <path
            d={`M${arcPoint(-60, ROLL_R).join(" ")} A${ROLL_R} ${ROLL_R} 0 0 1 ${arcPoint(60, ROLL_R).join(" ")}`}
            opacity={0.5}
          />
          {ROLL_TICKS.flatMap((deg) =>
            [-deg, deg].map((a) => {
              const [x1, y1] = arcPoint(a, ROLL_R);
              const [x2, y2] = arcPoint(a, ROLL_R + rollTickLength(deg));
              return <line key={a} data-roll-tick={a} x1={x1} y1={y1} x2={x2} y2={y2} />;
            }),
          )}
          {/* wings-level index */}
          <polygon
            points={`${CX},${CY - ROLL_R} ${CX - 8},${CY - ROLL_R - 14} ${CX + 8},${CY - ROLL_R - 14}`}
            fill="var(--hud-primary)"
            stroke="none"
          />
        </g>

        {att ? (
          <g
            data-testid="hud-horizon"
            transform={`rotate(${-att.roll} ${CX} ${CY}) translate(0 ${att.pitch * PX_PER_DEG})`}
          >
            <g
              stroke="var(--hud-primary)"
              strokeWidth={1.3}
              fill="var(--hud-primary)"
              opacity={0.8}
            >
              <Ladder pitch={att.pitch} />
            </g>
            {/* sky pointer: banks with the horizon, read against the fixed scale */}
            <polygon
              transform={`translate(0 ${-att.pitch * PX_PER_DEG})`}
              points={`${CX},${CY - ROLL_R + 4} ${CX - 8},${CY - ROLL_R + 18} ${CX + 8},${CY - ROLL_R + 18}`}
              fill="none"
              stroke="var(--hud-primary)"
              strokeWidth={1.6}
            />
          </g>
        ) : (
          <g data-testid="attitude-flag">
            <rect
              x={CX - 34}
              y={CY - 92}
              width={68}
              height={28}
              rx={4}
              fill="var(--hud-glass-strong)"
              stroke="var(--hud-crit)"
              strokeWidth={1.6}
            />
            <text
              x={CX}
              y={CY - 73}
              textAnchor="middle"
              stroke="none"
              // Inline so the stylesheet's HUD text colour cannot repaint the
              // failure flag in the normal instrument colour.
              style={{ fill: "var(--hud-crit)", fontWeight: 700, letterSpacing: "0.12em" }}
            >
              {attFlagLabel}
            </text>
          </g>
        )}

        {/* flight-path marker: where the aircraft is going */}
        {fpm && (
          <g
            data-testid="hud-fpm"
            stroke="var(--hud-primary)"
            strokeWidth={2}
            fill="none"
            opacity={fpm.clamped ? 0.5 : 1}
            strokeDasharray={fpm.clamped ? "4 3" : undefined}
          >
            <circle cx={fpm.x} cy={fpm.y} r={9} />
            <line x1={fpm.x - 24} y1={fpm.y} x2={fpm.x - 9} y2={fpm.y} />
            <line x1={fpm.x + 9} y1={fpm.y} x2={fpm.x + 24} y2={fpm.y} />
            <line x1={fpm.x} y1={fpm.y - 9} x2={fpm.x} y2={fpm.y - 19} />
          </g>
        )}

        {/* boresight / waterline and centre crosshair (fixed) */}
        <g stroke="var(--hud-primary)" strokeWidth={2} fill="none" data-testid="hud-boresight">
          <polyline points={`${CX - 62},${CY} ${CX - 22},${CY} ${CX - 12},${CY + 10}`} />
          <polyline points={`${CX + 62},${CY} ${CX + 22},${CY} ${CX + 12},${CY + 10}`} />
          <line x1={CX - 5} y1={CY} x2={CX + 5} y2={CY} />
          <line x1={CX} y1={CY - 5} x2={CX} y2={CY + 5} />
        </g>
      </svg>
    </div>
  );
});
