"use client";

/**
 * @module MissionProgressBar
 * @description Shows active mission name and waypoint progress for the Drone Context Rail.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

export function MissionProgressBar() {
  const t = useTranslations("missionProgress");
  // In demo mode, show a simulated mission progress
  const currentWp = 6;
  const totalWps = 12;
  const missionName = "patrol_grid_01";
  const percent = (currentWp / totalWps) * 100;

  return (
    <div className="rounded border border-border-default bg-bg-tertiary p-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary">{t("mission")}</span>
        <span className="text-[10px] font-mono text-text-secondary truncate ml-1">
          {missionName}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-text-tertiary">Waypoint</span>
        <span className="text-[10px] font-mono text-accent-primary">
          {currentWp} / {totalWps}
        </span>
      </div>
      <div className="h-1 bg-bg-secondary rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-primary rounded-full transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
