"use client";

/**
 * @module cockpit/flight/CentreMarks
 * @description The clean centre (cockpit spec `centre_marks` layer): a small
 * reticle at the boresight, a short horizon mark that follows roll and pitch,
 * and a small heading readout above. Drawn at every layer level where the
 * centre marks are on; the full instruments replace them at `instruments`.
 *
 * @license GPL-3.0-only
 */

import { memo } from "react";

import type { HudInstruments } from "@/lib/hud-readings";
import { NO_DATA_GLYPH } from "@/lib/hud-draw";

/** Pitch (deg) that moves the horizon mark by `PITCH_PX`. */
const PITCH_DEG = 20;
const PITCH_PX = 60;
const MARK_HALF = 46;
const MARK_GAP = 18;

export const CentreMarks = memo(function CentreMarks({ reading }: { reading: HudInstruments }) {
  const known = reading.pitch !== null && reading.roll !== null;
  const dy = known ? Math.max(-PITCH_PX, Math.min(PITCH_PX, ((reading.pitch ?? 0) / PITCH_DEG) * PITCH_PX)) : 0;
  const hdg = reading.heading === null ? NO_DATA_GLYPH : `${String(Math.round(reading.heading) % 360).padStart(3, "0")}°`;
  return (
    <div className="fs-centre" data-testid="centre-marks" aria-hidden="true">
      <span className="fs-centre-hdg" data-testid="centre-heading">
        {hdg}
      </span>
      <svg className="fs-centre-svg" viewBox="-100 -100 200 200">
        <g opacity={known ? 1 : 0.35} transform={`rotate(${-(reading.roll ?? 0)}) translate(0 ${dy})`}>
          <line x1={-MARK_HALF - MARK_GAP} y1={0} x2={-MARK_GAP} y2={0} />
          <line x1={MARK_GAP} y1={0} x2={MARK_HALF + MARK_GAP} y2={0} />
        </g>
        <circle cx={0} cy={0} r={6} />
        <line x1={0} y1={-14} x2={0} y2={-9} />
        <line x1={0} y1={9} x2={0} y2={14} />
        <line x1={-14} y1={0} x2={-9} y2={0} />
        <line x1={9} y1={0} x2={14} y2={0} />
      </svg>
    </div>
  );
});
