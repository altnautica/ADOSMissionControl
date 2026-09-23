/**
 * @module MissionStatsBar
 * @description Compact stats overlay at the bottom-left of the map showing
 * waypoint count, total distance, estimated time, max altitude, and the mean
 * speed over the planned route (distance / planned duration).
 * Uses 3D distance (haversine + altitude) to match simulation calculations.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/simulation-utils";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatAltitude, formatSpeed } from "@/lib/units/format";

interface MissionStatsBarProps {
  waypoints: Waypoint[];
  defaultSpeed: number;
  /** Lift the bar above the altitude profile when it is present/expanded. */
  bottomOffset?: number;
}

export function MissionStatsBar({ waypoints, defaultSpeed, bottomOffset }: MissionStatsBarProps) {
  const t = useTranslations("planner");
  const units = useSettingsStore((s) => s.units);
  const stats = useMemo(() => {
    const plan = computeFlightPlan(waypoints, defaultSpeed);
    let maxAlt = 0;
    for (const wp of waypoints) {
      if (wp.alt > maxAlt) maxAlt = wp.alt;
    }
    // Use the flight plan's own duration, which already accounts for per-leg
    // speed overrides and hold/loiter times, rather than distance ÷ one speed —
    // so the ETA matches the simulation's playback length.
    const estTime = plan.totalDuration;
    // Mean speed over the planned route (per-leg speeds and holds included);
    // null when the plan has no duration to divide by.
    const avgSpeed = estTime > 0 ? plan.totalDistance / estTime : null;
    return {
      wpCount: waypoints.length,
      totalDistance: plan.totalDistance,
      estTimeMin: Math.ceil(estTime / 60),
      maxAlt,
      avgSpeed,
    };
  }, [waypoints, defaultSpeed]);

  if (waypoints.length === 0) return null;

  return (
    <div
      className="absolute left-3 z-[1000]"
      style={{ bottom: bottomOffset ?? 16 }}
    >
      <div className="flex items-center gap-3 bg-bg-secondary/90 border border-border-default px-3 py-1.5">
        <Stat label={`${stats.wpCount}WP`} />
        <Sep />
        <Stat label={formatDistance(stats.totalDistance, units)} />
        <Sep />
        <Stat label={`~${stats.estTimeMin}m`} />
        <Sep />
        <Stat label={`${formatAltitude(stats.maxAlt, units)} ${t("max")}`} />
        {stats.avgSpeed !== null && (
          <>
            <Sep />
            <Stat label={`${formatSpeed(stats.avgSpeed, units)} ${t("avg")}`} />
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label }: { label: string }) {
  return <span className="text-[10px] font-mono text-text-secondary">{label}</span>;
}

function Sep() {
  return <span className="text-[10px] text-text-tertiary">|</span>;
}
