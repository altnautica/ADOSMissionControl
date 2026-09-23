"use client";

/**
 * @module fly/cockpit/Tapes
 * @description Speed & altitude tapes, styled by `.tape.l` / `.tape.r` (a tall `.rail` of neighbour `.tick`s around a filled `.now` value
 * box). The rail ALWAYS renders its full tick ladder (3 above + 3 below) so it
 * keeps its tall instrument shape even with no telemetry — the `.now` box shows
 * the live reading, the ticks show value ± step, and both fall back to blank/"—"
 * honestly when there is no fresh value (no fabricated reading).
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { useHudInstruments } from "@/hooks/use-hud-instruments";

const ABOVE = [3, 2, 1];
const BELOW = [-1, -2, -3];

interface TapeProps {
  value: number | null;
  side: "l" | "r";
  cap: string;
  step: number;
  decimals: number;
}

function Tape({ value, side, cap, step, decimals }: TapeProps) {
  // Every tick row always shows a value (or "--" when there's no telemetry) so
  // the rail reads as an instrument, never a blank gap.
  const tickText = (k: number) =>
    value === null ? "--" : String(Math.round(value + k * step));

  return (
    <div className={`tape ${side} d-std`} aria-hidden="true">
      <div className="rail">
        {ABOVE.map((k) => (
          <div key={`a${k}`} className="tick">
            {tickText(k)}
          </div>
        ))}
        <div className="now">
          <span className="cap">{cap}</span>
          {value === null ? "—" : value.toFixed(decimals)}
        </div>
        {BELOW.map((k) => (
          <div key={`b${k}`} className="tick">
            {tickText(k)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SpeedTape() {
  const t = useTranslations("cockpit");
  const { speedMps } = useHudInstruments();
  return <Tape value={speedMps} side="l" cap={`${t("strip.spd")} m/s`} step={1} decimals={1} />;
}

export function AltTape() {
  const t = useTranslations("cockpit");
  const { alt } = useHudInstruments();
  return <Tape value={alt} side="r" cap={`${t("strip.alt")} m`} step={5} decimals={0} />;
}
