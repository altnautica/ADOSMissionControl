/**
 * @module OrbitConfigSection
 * @description Orbit pattern configuration UI.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { useDrawingStore } from "@/stores/drawing-store";
import { Circle } from "lucide-react";
import { DIRECTION_OPTIONS } from "./pattern-editor-constants";

export function OrbitConfig() {
  const t = useTranslations("planner");
  const orbitConfig = usePatternStore((s) => s.orbitConfig);
  const updateOrbitConfig = usePatternStore((s) => s.updateOrbitConfig);
  const drawnCircles = useDrawingStore((s) => s.circles);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Circle size={12} />
        <span>
          {orbitConfig.center
            ? `Center: ${orbitConfig.center[0].toFixed(4)}, ${orbitConfig.center[1].toFixed(4)}`
            : drawnCircles.length > 0 ? t("usingLastDrawnCircle") : t("drawCircleFirst")}
        </span>
      </div>
      <Input label={t("radius")} type="number" unit="m" value={String(orbitConfig.radius ?? 50)}
        onChange={(e) => updateOrbitConfig({ radius: parseFloat(e.target.value) || 50 })} />
      <Select label={t("direction")} options={DIRECTION_OPTIONS} value={orbitConfig.direction ?? "cw"}
        onChange={(v) => updateOrbitConfig({ direction: v as "cw" | "ccw" })} />
      <Input label={t("turns")} type="number" value={String(orbitConfig.turns ?? 1)}
        onChange={(e) => updateOrbitConfig({ turns: parseInt(e.target.value) || 1 })} />
      <Input label={t("startAngle")} type="number" unit="deg" placeholder="0 = North" value={String(orbitConfig.startAngle ?? 0)}
        onChange={(e) => updateOrbitConfig({ startAngle: parseFloat(e.target.value) || 0 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitude")} type="number" unit="m" value={String(orbitConfig.altitude ?? 50)}
          onChange={(e) => updateOrbitConfig({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(orbitConfig.speed ?? 5)}
          onChange={(e) => updateOrbitConfig({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}
