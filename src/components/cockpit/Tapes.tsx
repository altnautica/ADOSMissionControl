"use client";

/**
 * @module fly/cockpit/Tapes
 * @description The scrolling edge tapes of the cockpit HUD: speed on the left,
 * altitude on the right, and the vertical-speed indicator beside the altitude
 * tape. Each tape is a scale that scrolls under a fixed value box, so the
 * neighbouring graduations move with the reading the way an aircraft tape
 * does. Pure over their props: `HudLayer` derives the reading once per frame.
 *
 * A null reading (stale or absent source) keeps the graduations but drops
 * their numbers, shows "—" in the value box, and marks the instrument
 * `data-stale` so it dims; nothing is drawn as a fabricated 0.
 * @license GPL-3.0-only
 */

import { memo, type ReactNode } from "react";
import { formatHud, formatSigned } from "@/components/cockpit/hud/format";

const TAPE_W = 78;
const TAPE_H = 240;
const MID = TAPE_H / 2;
const BOX_H = 36;
const TEXT_STYLE = {
  fontFamily: "var(--mono)",
  fontVariantNumeric: "tabular-nums",
} as const;

interface ScaleSpec {
  /** Pixels per unit of the reading. */
  pxPerUnit: number;
  /** Graduation spacing, in units. */
  tickStep: number;
  /** Labelled graduation spacing, in units (a multiple of `tickStep`). */
  labelStep: number;
  /** Lowest value the scale can show (speed never goes below 0). */
  floor?: number;
}

interface TapeScaleProps extends ScaleSpec {
  value: number | null;
  side: "l" | "r";
  decimals: number;
}

/** The scrolling SVG scale plus its fixed value box. */
function TapeScale({ value, side, decimals, pxPerUnit, tickStep, labelStep, floor }: TapeScaleProps) {
  const centre = value ?? 0;
  const span = MID / pxPerUnit;
  const first = Math.ceil((centre - span) / tickStep) * tickStep;
  const last = Math.floor((centre + span) / tickStep) * tickStep;
  // Graduations sit on the edge facing the centre of the picture.
  const edge = side === "l" ? TAPE_W - 2 : 2;
  const dir = side === "l" ? -1 : 1;
  const labelX = side === "l" ? TAPE_W - 20 : 20;
  const anchor = side === "l" ? "end" : "start";

  const marks: ReactNode[] = [];
  for (let k = first; k <= last + 1e-9; k += tickStep) {
    const v = Math.round(k / tickStep) * tickStep;
    if (floor !== undefined && v < floor) continue;
    const y = MID - (v - centre) * pxPerUnit;
    const major = Math.abs(v % labelStep) < 1e-9;
    marks.push(
      <line
        key={`t${v}`}
        x1={edge}
        y1={y}
        x2={edge + dir * (major ? 12 : 6)}
        y2={y}
      />,
    );
    if (major && value !== null && Math.abs(y - MID) > BOX_H / 2 + 4) {
      marks.push(
        <text key={`l${v}`} x={labelX} y={y + 4} textAnchor={anchor} stroke="none">
          {v}
        </text>,
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${TAPE_W} ${TAPE_H}`}
      width="100%"
      className="tape-scale"
      style={TEXT_STYLE}
    >
      <g stroke="var(--hud-ink-2)" strokeWidth={1.2} fill="var(--hud-ink-2)" fontSize={13}>
        {marks}
      </g>
      <rect
        x={2}
        y={MID - BOX_H / 2}
        width={TAPE_W - 4}
        height={BOX_H}
        rx={4}
        fill="var(--hud-glass-strong)"
        stroke="var(--hud-primary)"
        strokeWidth={1.6}
      />
      <text
        data-testid="tape-value"
        x={TAPE_W / 2}
        y={MID + 7}
        textAnchor="middle"
        fill="var(--hud-ink)"
        fontSize={20}
        fontWeight={700}
      >
        {formatHud(value, decimals)}
      </text>
    </svg>
  );
}

interface SpeedTapeProps {
  value: number | null;
  /** Short source label: ground speed or indicated airspeed. */
  caption: string;
}

export const SpeedTape = memo(function SpeedTape({ value, caption }: SpeedTapeProps) {
  return (
    <div className="tape l" data-testid="speed-tape" data-stale={value === null} aria-hidden="true">
      <div className="tape-cap">
        <span>{caption}</span>
        <small>m/s</small>
      </div>
      <div className="rail">
        <TapeScale
          value={value}
          side="l"
          decimals={1}
          pxPerUnit={8}
          tickStep={1}
          labelStep={5}
          floor={0}
        />
      </div>
    </div>
  );
});

interface AltTapeProps {
  value: number | null;
  caption: string;
  /** The reference toggle (REL/MSL), rendered under the caption. */
  refToggle: ReactNode;
}

export const AltTape = memo(function AltTape({ value, caption, refToggle }: AltTapeProps) {
  return (
    <div className="tape r" data-testid="alt-tape" data-stale={value === null}>
      <div className="tape-cap" aria-hidden="true">
        <span>{caption}</span>
        <small>m</small>
      </div>
      <div className="rail" aria-hidden="true">
        <TapeScale
          value={value}
          side="r"
          decimals={0}
          pxPerUnit={4}
          tickStep={5}
          labelStep={20}
        />
      </div>
      {refToggle}
    </div>
  );
});

/** Vertical speed full-scale, m/s. The scale is square-root so small rates stay readable. */
const VSI_FULL_MPS = 10;
const VSI_HALF_PX = 100;
const VSI_W = 34;
/** VSI viewBox height: caption row, ±full-scale, value row. */
const VSI_H = 2 * VSI_HALF_PX + 60;
const VSI_MID = VSI_H / 2;
const VSI_TICKS = [0, 1, 2, 5, 10] as const;

/** Vertical offset of a climb rate on the VSI (negative = up). */
export function vsiOffset(mps: number): number {
  const mag = Math.sqrt(Math.min(Math.abs(mps), VSI_FULL_MPS) / VSI_FULL_MPS);
  return -Math.sign(mps) * mag * VSI_HALF_PX;
}

interface VsiProps {
  value: number | null;
  caption: string;
}

export const VerticalSpeedIndicator = memo(function VerticalSpeedIndicator({
  value,
  caption,
}: VsiProps) {
  return (
    <div className="hud-vsi" data-testid="vsi" data-stale={value === null} aria-hidden="true">
      <svg viewBox={`0 0 ${VSI_W} ${VSI_H}`} width="100%" style={TEXT_STYLE}>
        <g stroke="var(--hud-ink-2)" strokeWidth={1.2}>
          {VSI_TICKS.flatMap((v) =>
            (v === 0 ? [0] : [v, -v]).map((s) => {
              const y = VSI_MID + vsiOffset(s);
              return <line key={s} x1={2} y1={y} x2={v === 0 ? 14 : 9} y2={y} />;
            }),
          )}
        </g>
        <g fill="var(--hud-ink-2)" fontSize={9}>
          {[2, 5, 10].map((v) => (
            <text key={v} x={12} y={VSI_MID + vsiOffset(v) + 3}>
              {v}
            </text>
          ))}
        </g>
        {value !== null && (
          <line
            data-testid="vsi-needle"
            x1={2}
            y1={VSI_MID}
            x2={VSI_W - 4}
            y2={VSI_MID + vsiOffset(value)}
            stroke="var(--hud-primary)"
            strokeWidth={2.2}
          />
        )}
        <text x={VSI_W / 2} y={12} textAnchor="middle" fill="var(--hud-muted)" fontSize={8}>
          {caption}
        </text>
        <text
          data-testid="vsi-value"
          x={VSI_W / 2}
          y={VSI_H - 6}
          textAnchor="middle"
          fill="var(--hud-ink)"
          fontSize={10}
        >
          {formatSigned(value, 1)}
        </text>
      </svg>
    </div>
  );
});
