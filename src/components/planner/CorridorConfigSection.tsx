/**
 * @module CorridorConfigSection
 * @description Corridor pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { usePlannerStore } from "@/stores/planner-store";
import { Route, PenLine } from "lucide-react";

export function CorridorConfig() {
  const t = useTranslations("planner");
  const corridorConfig = usePatternStore((s) => s.corridorConfig);
  const updateCorridorConfig = usePatternStore((s) => s.updateCorridorConfig);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Route size={12} />
        <span>
          {corridorConfig.pathPoints
            ? `${corridorConfig.pathPoints.length} ${t("pathPoints")}`
            : t("drawCorridorHint")}
        </span>
      </div>
      {/* Arm a polygon draw tagged for the pattern, so the completed line feeds
          the corridor centerline (routed by the draw-mode destination tag). */}
      <button
        onClick={() => usePlannerStore.getState().setMode({ kind: "draw", shape: "polygon", drawingFor: "pattern" })}
        className="flex items-center justify-center gap-2 py-1.5 text-xs font-mono
          text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10
          transition-colors cursor-pointer"
      >
        <PenLine size={12} />
        {t("drawCorridorPath")}
      </button>
      <Input label={t("corridorWidth")} type="number" unit="m" value={String(corridorConfig.corridorWidth ?? 50)}
        onChange={(e) => updateCorridorConfig({ corridorWidth: parseFloat(e.target.value) || 50 })} />
      <Input label={t("lineSpacing")} type="number" unit="m" value={String(corridorConfig.lineSpacing ?? 20)}
        onChange={(e) => updateCorridorConfig({ lineSpacing: parseFloat(e.target.value) || 20 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitudeAboveHome")} type="number" unit="m" value={String(corridorConfig.altitude ?? 50)}
          onChange={(e) => updateCorridorConfig({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(corridorConfig.speed ?? 5)}
          onChange={(e) => updateCorridorConfig({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}
