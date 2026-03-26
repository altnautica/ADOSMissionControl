/**
 * @module StructureScanConfigSection
 * @description Structure scan pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { Building } from "lucide-react";
import { SCAN_DIRECTION_OPTIONS } from "./pattern-editor-constants";

export function StructureScanConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.structureScanConfig);
  const update = usePatternStore((s) => s.updateStructureScanConfig);
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Building size={12} />
        <span>
          {config.structurePolygon
            ? t("verticesCount", { count: config.structurePolygon.length })
            : drawnPolygons.length > 0
              ? t("usingLastDrawnPolygon", { count: drawnPolygons[drawnPolygons.length - 1].vertices.length })
              : t("drawStructureBoundary")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("bottomAlt")} type="number" unit="m" value={String(config.bottomAlt ?? 10)}
          onChange={(e) => update({ bottomAlt: parseFloat(e.target.value) || 10 })} />
        <Input label={t("topAlt")} type="number" unit="m" value={String(config.topAlt ?? 50)}
          onChange={(e) => update({ topAlt: parseFloat(e.target.value) || 50 })} />
      </div>
      <Input label={t("layerSpacing")} type="number" unit="m" value={String(config.layerSpacing ?? 10)}
        onChange={(e) => update({ layerSpacing: parseFloat(e.target.value) || 10 })} />
      <Input label={t("scanDistance")} type="number" unit="m" value={String(config.scanDistance ?? 15)}
        onChange={(e) => update({ scanDistance: parseFloat(e.target.value) || 15 })} />
      <Input label={t("gimbalPitch")} type="number" unit="deg" value={String(config.gimbalPitch ?? -30)}
        onChange={(e) => update({ gimbalPitch: parseFloat(e.target.value) || -30 })} />
      <Input label={t("pointsPerLayer")} type="number" value={String(config.pointsPerLayer ?? 16)}
        onChange={(e) => update({ pointsPerLayer: parseInt(e.target.value) || 16 })} />
      <Select label={t("direction")} options={SCAN_DIRECTION_OPTIONS} value={config.direction ?? "bottom-up"}
        onChange={(v) => update({ direction: v as "bottom-up" | "top-down" })} />
      <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 3)}
        onChange={(e) => update({ speed: parseFloat(e.target.value) || 3 })} />
    </>
  );
}
