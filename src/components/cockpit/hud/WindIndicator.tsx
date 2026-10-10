"use client";

/**
 * @module cockpit/hud/WindIndicator
 * @description Wind estimate from the flight controller's WIND message: an
 * arrow pointing where the wind blows, relative to the nose, plus its speed
 * and the direction it comes from. Not rendered at all without a fresh wind
 * estimate (most flight stacks never send one). The arrow needs a heading to
 * be drawn relative to; without one only the numbers show.
 * @license GPL-3.0-only
 */

import { memo } from "react";
import type { WindReading } from "@/lib/hud-readings";
import { formatHeading, formatHud } from "@/components/cockpit/hud/format";

interface WindIndicatorProps {
  wind: WindReading | null;
  heading: number | null;
  label: string;
}

export const WindIndicator = memo(function WindIndicator({
  wind,
  heading,
  label,
}: WindIndicatorProps) {
  if (!wind) return null;
  // The wind blows toward fromDeg + 180; the arrow is drawn relative to the nose.
  const rotation = heading === null ? null : wind.fromDeg + 180 - heading;
  return (
    <div className="hud-wind" data-testid="hud-wind" aria-hidden="true">
      {rotation !== null && (
        <svg viewBox="0 0 24 24" width={22} height={22}>
          <g transform={`rotate(${rotation} 12 12)`} stroke="var(--hud-primary)" strokeWidth={2} fill="none">
            <line x1={12} y1={20} x2={12} y2={5} />
            <polyline points="7,10 12,4 17,10" />
          </g>
        </svg>
      )}
      <span className="k">{label}</span>
      <span className="v">
        {formatHud(wind.speedMps, 1)}
        <small>m/s</small> {formatHeading(wind.fromDeg)}°
      </span>
    </div>
  );
});
