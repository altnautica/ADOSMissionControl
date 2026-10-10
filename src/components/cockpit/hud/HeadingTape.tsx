"use client";

/**
 * @module cockpit/hud/HeadingTape
 * @description The HUD heading tape: a compass scale scrolling under a fixed
 * heading box, graduated every 5° and labelled every 10° (cardinals by
 * letter), with a caret marking the bearing to home. A home bearing outside
 * the visible arc pins the caret to the nearer edge so the turn direction is
 * still readable. No heading ⇒ no labels, "—" in the box, `data-stale`.
 * @license GPL-3.0-only
 */

import { memo, type ReactNode } from "react";
import { formatHeading } from "@/components/cockpit/hud/format";
import { angleDiff } from "@/lib/hud-readings";

const W = 480;
const H = 48;
const CX = W / 2;
const PX_PER_DEG = 6;
const HALF_SPAN_DEG = CX / PX_PER_DEG;
const TICK_Y = 24;

interface HeadingTapeProps {
  heading: number | null;
  homeBearing: number | null;
  /** Labels for 0/90/180/270. */
  cardinals: readonly [string, string, string, string];
  /** Text beside the home caret. */
  homeLabel: string;
}

export const HeadingTape = memo(function HeadingTape({
  heading,
  homeBearing,
  cardinals,
  homeLabel,
}: HeadingTapeProps) {
  const centre = heading ?? 0;
  const first = Math.ceil((centre - HALF_SPAN_DEG) / 5) * 5;
  const marks: ReactNode[] = [];
  for (let deg = first; deg <= centre + HALF_SPAN_DEG; deg += 5) {
    const x = CX + (deg - centre) * PX_PER_DEG;
    const norm = ((deg % 360) + 360) % 360;
    const major = norm % 10 === 0;
    marks.push(<line key={`t${deg}`} x1={x} y1={TICK_Y} x2={x} y2={TICK_Y + (major ? 9 : 5)} />);
    if (major && heading !== null && Math.abs(x - CX) > 26) {
      const label = norm % 90 === 0 ? cardinals[norm / 90] : String(norm);
      marks.push(
        <text key={`l${deg}`} x={x} y={H - 2} textAnchor="middle" stroke="none">
          {label}
        </text>,
      );
    }
  }

  let caret: ReactNode = null;
  if (heading !== null && homeBearing !== null) {
    const off = angleDiff(homeBearing, heading) * PX_PER_DEG;
    const x = CX + Math.max(-CX + 8, Math.min(CX - 8, off));
    caret = (
      <g data-testid="home-caret" fill="var(--hud-good)" stroke="none">
        <polygon points={`${x},${TICK_Y - 1} ${x - 6},${TICK_Y - 9} ${x + 6},${TICK_Y - 9}`} />
        <text x={x + 9} y={TICK_Y - 3} fontSize={10}>
          {homeLabel}
        </text>
      </g>
    );
  }

  return (
    <div className="hud-hdg" data-testid="heading-tape" data-stale={heading === null} aria-hidden="true">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        style={{ fontFamily: "var(--mono)", fontVariantNumeric: "tabular-nums" }}
      >
        <g stroke="var(--hud-ink-2)" strokeWidth={1.2} fill="var(--hud-ink-2)" fontSize={11}>
          {marks}
        </g>
        {caret}
        <rect
          x={CX - 26}
          y={1}
          width={52}
          height={20}
          rx={4}
          fill="var(--hud-glass-strong)"
          stroke="var(--hud-primary)"
          strokeWidth={1.4}
        />
        <text
          data-testid="heading-value"
          x={CX}
          y={16}
          textAnchor="middle"
          fill="var(--hud-ink)"
          fontSize={14}
          fontWeight={700}
        >
          {formatHeading(heading)}
        </text>
        <line x1={CX} y1={21} x2={CX} y2={TICK_Y + 10} stroke="var(--hud-primary)" strokeWidth={2} />
      </svg>
    </div>
  );
});
