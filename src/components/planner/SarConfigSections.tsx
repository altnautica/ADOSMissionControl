/**
 * @module SarConfigSections
 * @description SAR pattern configuration UIs — Expanding Square, Sector Search, Parallel Track.
 * Extracted from PatternConfigSections.tsx.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { usePatternStore } from "@/stores/pattern-store";
import { Search } from "lucide-react";

export function SarExpandingSquareConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.sarExpandingSquareConfig);
  const update = usePatternStore((s) => s.updateSarExpandingSquareConfig);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Search size={12} />
        <span>{config.center ? `Datum: ${config.center[0].toFixed(4)}, ${config.center[1].toFixed(4)}` : t("clickMapSetDatum")}</span>
      </div>
      <Input label={t("legSpacing")} type="number" unit="m" value={String(config.legSpacing ?? 50)}
        onChange={(e) => update({ legSpacing: parseFloat(e.target.value) || 50 })} />
      <Input label={t("maxLegs")} type="number" value={String(config.maxLegs ?? 20)}
        onChange={(e) => update({ maxLegs: parseInt(e.target.value) || 20 })} />
      <Input label={t("startBearing")} type="number" unit="deg" value={String(config.startBearing ?? 0)}
        onChange={(e) => update({ startBearing: parseFloat(e.target.value) || 0 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitude")} type="number" unit="m" value={String(config.altitude ?? 50)}
          onChange={(e) => update({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 5)}
          onChange={(e) => update({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}

export function SarSectorSearchConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.sarSectorSearchConfig);
  const update = usePatternStore((s) => s.updateSarSectorSearchConfig);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Search size={12} />
        <span>{config.center ? `Datum: ${config.center[0].toFixed(4)}, ${config.center[1].toFixed(4)}` : t("clickMapSetDatum")}</span>
      </div>
      <Input label={t("searchRadius")} type="number" unit="m" value={String(config.radius ?? 200)}
        onChange={(e) => update({ radius: parseFloat(e.target.value) || 200 })} />
      <Input label={t("sweeps")} type="number" value={String(config.sweeps ?? 3)}
        onChange={(e) => update({ sweeps: parseInt(e.target.value) || 3 })} />
      <Input label={t("startBearing")} type="number" unit="deg" value={String(config.startBearing ?? 0)}
        onChange={(e) => update({ startBearing: parseFloat(e.target.value) || 0 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitude")} type="number" unit="m" value={String(config.altitude ?? 50)}
          onChange={(e) => update({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 5)}
          onChange={(e) => update({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}

export function SarParallelTrackConfig() {
  const t = useTranslations("planner");
  const config = usePatternStore((s) => s.sarParallelTrackConfig);
  const update = usePatternStore((s) => s.updateSarParallelTrackConfig);
  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Search size={12} />
        <span>{config.startPoint ? `Start: ${config.startPoint[0].toFixed(4)}, ${config.startPoint[1].toFixed(4)}` : t("clickMapSetStart")}</span>
      </div>
      <Input label={t("trackLength")} type="number" unit="m" value={String(config.trackLength ?? 500)}
        onChange={(e) => update({ trackLength: parseFloat(e.target.value) || 500 })} />
      <Input label={t("trackSpacing")} type="number" unit="m" value={String(config.trackSpacing ?? 50)}
        onChange={(e) => update({ trackSpacing: parseFloat(e.target.value) || 50 })} />
      <Input label={t("trackCount")} type="number" value={String(config.trackCount ?? 10)}
        onChange={(e) => update({ trackCount: parseInt(e.target.value) || 10 })} />
      <Input label={t("bearing")} type="number" unit="deg" value={String(config.bearing ?? 0)}
        onChange={(e) => update({ bearing: parseFloat(e.target.value) || 0 })} />
      <div className="grid grid-cols-2 gap-2">
        <Input label={t("altitude")} type="number" unit="m" value={String(config.altitude ?? 50)}
          onChange={(e) => update({ altitude: parseFloat(e.target.value) || 50 })} />
        <Input label={t("speedMs")} type="number" unit="m/s" value={String(config.speed ?? 5)}
          onChange={(e) => update({ speed: parseFloat(e.target.value) || 5 })} />
      </div>
    </>
  );
}
