/**
 * @module MissionStatsBar
 * @description Compact stats overlay at the bottom-left of the map showing
 * waypoint count, total distance, estimated time, max altitude, and average speed.
 * Uses 3D distance (haversine + altitude) to match simulation calculations.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { Waypoint } from "@/lib/types";
import { computeFlightPlan } from "@/lib/simulation-utils";

interface MissionStatsBarProps {
  waypoints: Waypoint[];
  defaultSpeed: number;
}

export function MissionStatsBar({ waypoints, defaultSpeed }: MissionStatsBarProps) {
  const t = useTranslations("planner");
  const stats = useMemo(() => {
    const plan = computeFlightPlan(waypoints, defaultSpeed);
    let maxAlt = 0;
    for (const wp of waypoints) {
      if (wp.alt > maxAlt) maxAlt = wp.alt;
    }
    const avgSpeed = defaultSpeed || 5;
    const estTime = plan.totalDistance / avgSpeed;
    return {
      wpCount: waypoints.length,
      totalDistKm: (plan.totalDistance / 1000).toFixed(1),
      estTimeMin: Math.ceil(estTime / 60),
      maxAlt: Math.round(maxAlt),
      avgSpeed: Math.round(avgSpeed),
    };
  }, [waypoints, defaultSpeed]);

  if (waypoints.length === 0) return null;

  return (
    <div className="absolute bottom-4 left-3 z-[1000]">
      <div className="flex items-center gap-3 bg-bg-secondary/90 border border-border-default px-3 py-1.5">
        <Stat label={`${stats.wpCount}WP`} />
        <Sep />
        <Stat label={`${stats.totalDistKm}km`} />
        <Sep />
        <Stat label={`~${stats.estTimeMin}m`} />
        <Sep />
        <Stat label={`${stats.maxAlt}m ${t("max")}`} />
        <Sep />
        <Stat label={`${stats.avgSpeed}m/s`} />
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
