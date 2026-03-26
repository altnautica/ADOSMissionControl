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
import { Route } from "lucide-react";

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
      <Input label={t("corridorWidth")} type="number" unit="m" value={String(corridorConfig.corridorWidth ?? 50)}
        onChange={(e) => updateCorridorConfig({ corridorWidth: parseFloat(e.target.value) || 50 })} />
      <Input label={t("lineSpacing")} type="number" unit="m" value={String(corridorConfig.lineSpacing ?? 20)}
        onChange={(e) => updateCorridorConfig({ lineSpacing: parseFloat(e.target.value) || 20 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitude")} type="number" unit="m" value={String(corridorConfig.altitude ?? 50)}
          onChange={(e) => updateCorridorConfig({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(corridorConfig.speed ?? 5)}
          onChange={(e) => updateCorridorConfig({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}
