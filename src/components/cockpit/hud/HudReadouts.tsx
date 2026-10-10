"use client";

/**
 * @module cockpit/hud/HudReadouts
 * @description Compact digital speed / altitude / vertical-speed readouts.
 * Rendered beside the tapes and hidden by default; the cockpit stylesheet
 * swaps the tapes out for these on a narrow cockpit, where three tall tapes
 * cost more picture than they return. Each readout dims (`data-stale`) and
 * shows "—" without a fresh source.
 * @license GPL-3.0-only
 */

import { memo, type ReactNode } from "react";
import { formatHud, formatSigned } from "@/components/cockpit/hud/format";

interface ReadoutProps {
  kind: "spd" | "alt" | "vs";
  label: string;
  text: string;
  unit: string;
  stale: boolean;
  children?: ReactNode;
}

function Readout({ kind, label, text, unit, stale, children }: ReadoutProps) {
  return (
    <div className={`ro ${kind}`} data-testid={`readout-${kind}`} data-stale={stale}>
      <span className="k" aria-hidden="true">
        {label}
      </span>
      <span className="v" aria-hidden="true">
        {text}
        <small>{unit}</small>
      </span>
      {children}
    </div>
  );
}

interface HudReadoutsProps {
  speed: number | null;
  speedLabel: string;
  alt: number | null;
  altLabel: string;
  climb: number | null;
  climbLabel: string;
  refToggle: ReactNode;
}

export const HudReadouts = memo(function HudReadouts({
  speed,
  speedLabel,
  alt,
  altLabel,
  climb,
  climbLabel,
  refToggle,
}: HudReadoutsProps) {
  return (
    <div className="hud-readouts" data-testid="hud-readouts">
      <Readout kind="spd" label={speedLabel} text={formatHud(speed, 1)} unit="m/s" stale={speed === null} />
      <Readout kind="alt" label={altLabel} text={formatHud(alt, 0)} unit="m" stale={alt === null}>
        {refToggle}
      </Readout>
      <Readout kind="vs" label={climbLabel} text={formatSigned(climb, 1)} unit="m/s" stale={climb === null} />
    </div>
  );
});
