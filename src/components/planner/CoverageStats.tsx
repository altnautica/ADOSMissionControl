/**
 * @module CoverageStats
 * @description Survey coverage statistics panel. Derives image count and front
 * overlap from the camera trigger distance, side overlap and line spacing from
 * the survey's navigation points, and swept ground coverage, and flags a
 * coverage gap when the line spacing is too wide for the target side overlap.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Layers, AlertTriangle } from "lucide-react";
import { usePatternStore } from "@/stores/pattern-store";
import type { CameraProfile } from "@/lib/patterns/gsd-calculator";
import { computeCoverageStats, detectCoverageGaps } from "@/lib/patterns/coverage";

interface CoverageStatsProps {
  camera: CameraProfile | undefined;
  altitude: number;
  /** Target side overlap as a fraction 0-1, used for the gap check. */
  minSideOverlap?: number;
}

function formatArea(m2: number): string {
  return m2 >= 10000 ? `${(m2 / 10000).toFixed(2)} ha` : `${Math.round(m2)} m²`;
}

export function CoverageStats({ camera, altitude, minSideOverlap = 0.6 }: CoverageStatsProps) {
  const t = useTranslations("survey");
  const activePatternType = usePatternStore((s) => s.activePatternType);
  const waypoints = usePatternStore((s) => s.patternResult?.waypoints);

  const data = useMemo(() => {
    if (!camera || activePatternType !== "survey" || !waypoints || waypoints.length < 2) {
      return null;
    }
    return {
      stats: computeCoverageStats(waypoints, camera, altitude),
      gaps: detectCoverageGaps(waypoints, camera, altitude, minSideOverlap),
    };
  }, [camera, altitude, minSideOverlap, activePatternType, waypoints]);

  if (!data) return null;
  const { stats, gaps } = data;

  const rows: Array<[string, string]> = [
    [t("coverage.images"), String(stats.imageCount)],
    [t("coverage.groundCoverage"), formatArea(stats.groundCoverageM2)],
    [t("coverage.frontOverlap"), stats.overlapFrontPct === null ? "—" : `${stats.overlapFrontPct.toFixed(0)}%`],
    [t("coverage.sideOverlap"), `${stats.overlapSidePct.toFixed(0)}%`],
    [t("coverage.lineSpacing"), `${stats.lineSpacingM.toFixed(1)} m`],
  ];

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5 bg-bg-secondary border border-border-default">
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary">
        <Layers size={11} className="text-accent-primary shrink-0" />
        <span>{t("coverage.title")}</span>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-text-tertiary">{label}</span>
            <span className="text-text-primary">{value}</span>
          </div>
        ))}
      </div>
      {gaps.hasGap && (
        <div className="flex items-start gap-1.5 text-[9px] font-mono text-status-warning">
          <AlertTriangle size={10} className="shrink-0 mt-0.5" />
          <span>{t("coverage.gapWarning")}</span>
        </div>
      )}
    </div>
  );
}
