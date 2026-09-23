"use client";

/**
 * Wind estimate card — derived from VFR_HUD airspeed vs groundspeed.
 *
 * @module components/history/detail/tabs/overview/WindCard
 */

import { Wind } from "lucide-react";
import type { WindEstimate } from "@/lib/types";
import { Row } from "./shared";

const COMPASS_LABELS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
] as const;

function compassLabel(deg: number): string {
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS_LABELS[idx];
}

export function WindCard({ wind, hasMetar }: { wind: WindEstimate; hasMetar: boolean }) {
  return (
    <div className="flex flex-col gap-1 mt-2 border-t border-border-default pt-2">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
        <Wind size={11} className="text-accent-primary" />
        Wind (estimated from FC)
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
        <Row label="Speed" value={`${wind.speedMs.toFixed(1)} m/s`} mono />
        <Row label="From" value={`${wind.fromDirDeg}° (${compassLabel(wind.fromDirDeg)})`} mono />
        <Row label="Samples" value={wind.sampleCount.toString()} mono />
        <Row label="Method" value={wind.method === "vfr_diff" ? "Ground track − airspeed" : "FC estimate"} />
      </div>
      {hasMetar && (
        <span className="text-[9px] text-text-tertiary mt-0.5">
          METAR wind shown above is from the nearest station. This estimate is derived from the flight controller.
        </span>
      )}
    </div>
  );
}
