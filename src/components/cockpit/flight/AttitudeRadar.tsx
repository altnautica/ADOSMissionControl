"use client";

/**
 * @module cockpit/flight/AttitudeRadar
 * @description The attitude radar face of the bottom-left card: a small
 * horizon ball (pitch and roll) inside a heading ring that turns with the
 * aircraft, with north and the bearing home marked on the ring. Without a
 * fresh attitude the ball is drawn flat and dim with the no-data flag, never
 * a remembered attitude.
 *
 * @license GPL-3.0-only
 */

import { memo } from "react";
import { specString } from "@/lib/cockpit/spec-strings";

import { useHudInstruments } from "@/hooks/use-hud-instruments";

/** Pitch (deg) that moves the horizon by the ball's radius. */
const PITCH_FULL_DEG = 45;

export const AttitudeRadar = memo(function AttitudeRadar({ size }: { droneId: string; size: number }) {
  const r = useHudInstruments();
  // Room above for the face's title and below for the page dots.
  const s = Math.max(64, size - 44);
  const c = s / 2;
  const ring = c - 6;
  const ball = ring - 12;
  const known = r.pitch !== null && r.roll !== null;
  const pitch = r.pitch ?? 0;
  const roll = r.roll ?? 0;
  const hdgKnown = r.heading !== null;
  const hdg = r.heading ?? 0;
  const shift = Math.max(-1, Math.min(1, pitch / PITCH_FULL_DEG)) * ball;
  const home = r.homeBearing;
  const ticks = Array.from({ length: 12 }, (_, i) => i * 30);
  const at = (deg: number, rad: number) => {
    const a = ((deg - hdg - 90) * Math.PI) / 180;
    return [c + Math.cos(a) * rad, c + Math.sin(a) * rad] as const;
  };
  const [nx, ny] = at(0, ring);
  const homeXY = home === null ? null : at(home, ring);

  return (
    <svg
      width={s}
      height={s}
      viewBox={`0 0 ${s} ${s}`}
      className="fs-attitude"
      role="img"
      aria-label={
        known
          ? specString("cockpit.card.attitude_aria", { pitch: Math.round(pitch), roll: Math.round(roll), hdg: Math.round(hdg) })
          : specString("cockpit.card.attitude_none")
      }
      data-testid="fs-attitude-radar"
      data-known={known ? "true" : "false"}
    >
      <defs>
        <clipPath id="fs-att-clip">
          <circle cx={c} cy={c} r={ball} />
        </clipPath>
      </defs>
      <g clipPath="url(#fs-att-clip)" opacity={known ? 1 : 0.35}>
        <g transform={`rotate(${-roll} ${c} ${c}) translate(0 ${shift})`}>
          <rect x={-s} y={-s * 2} width={s * 3} height={s * 2 + c} fill="rgb(56 120 190 / 0.55)" />
          <rect x={-s} y={c} width={s * 3} height={s * 2} fill="rgb(120 86 52 / 0.55)" />
          <line x1={-s} y1={c} x2={s * 2} y2={c} stroke="var(--fs-text)" strokeWidth={1.5} />
        </g>
      </g>
      <circle cx={c} cy={c} r={ball} fill="none" stroke="var(--fs-border)" />
      {/* An unknown heading dims the ring and its N mark like the ball: a
          north-up ring at full opacity would read as a known heading. */}
      <g opacity={hdgKnown ? 1 : 0.35} data-testid="fs-attitude-ring" data-known={hdgKnown ? "true" : "false"}>
        <circle cx={c} cy={c} r={ring} fill="none" stroke="var(--fs-border)" />
        {ticks.map((d) => {
          const [x1, y1] = at(d, ring);
          const [x2, y2] = at(d, ring - (d % 90 === 0 ? 7 : 4));
          return <line key={d} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--fs-text-dim)" strokeWidth={1} />;
        })}
        <text x={nx} y={ny + 3.5} textAnchor="middle" className="fs-att-n">
          N
        </text>
      </g>
      {homeXY && <circle cx={homeXY[0]} cy={homeXY[1]} r={4} fill="var(--fs-ok)" data-testid="fs-attitude-home" />}
      <path d={`M${c - 14} ${c} h9 l5 5 l5 -5 h9`} fill="none" stroke="var(--fs-warn)" strokeWidth={2} strokeLinejoin="round" />
      <path d={`M${c} ${c - ring + 2} l-5 -6 h10 z`} fill="var(--fs-text)" />
    </svg>
  );
});
