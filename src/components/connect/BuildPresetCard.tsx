"use client";

import { useTranslations } from "next-intl";
import type { BuildPreset } from "@/lib/presets/types";
import {
  Cpu,
  Navigation,
  Gauge,
  Timer,
  Battery,
  Zap,
} from "lucide-react";

const CATEGORY_COLORS: Record<string, string> = {
  fpv: "text-orange-400",
  "long-range": "text-blue-400",
  "heavy-lift": "text-red-400",
  cine: "text-purple-400",
  racing: "text-yellow-400",
  micro: "text-green-400",
  reference: "text-accent-primary",
};

export function BuildPresetCard({
  preset,
  selected,
  onSelect,
  onDetail,
}: {
  preset: BuildPreset;
  selected: boolean;
  onSelect: () => void;
  onDetail: () => void;
}) {
  const t = useTranslations("connect");
  const color = CATEGORY_COLORS[preset.category] ?? "text-text-secondary";
  const { specs } = preset;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`w-full text-left p-3 border transition-all cursor-pointer ${
        selected
          ? "border-accent-primary bg-accent-primary/8 ring-1 ring-accent-primary/30"
          : "border-border-default bg-bg-secondary hover:border-border-strong hover:bg-bg-tertiary"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-mono uppercase ${color}`}>
            {preset.category}
          </span>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDetail();
          }}
          className="text-[9px] text-text-tertiary hover:text-text-secondary underline"
        >
          {t("buildPreset.details")}
        </button>
      </div>

      {/* Name */}
      <h4 className="text-sm font-semibold text-text-primary mb-1 font-display">
        {preset.name}
      </h4>

      {/* Specs grid */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[10px] text-text-tertiary mt-2">
        <div className="flex items-center gap-1">
          <Zap size={10} className="shrink-0" />
          <span>{specs.motorSize} {specs.motorKv}KV</span>
        </div>
        <div className="flex items-center gap-1">
          <Gauge size={10} className="shrink-0" />
          <span>{specs.propSize} props</span>
        </div>
        <div className="flex items-center gap-1">
          <Battery size={10} className="shrink-0" />
          <span>{specs.cells}S {specs.batteryMah}mAh</span>
        </div>
        <div className="flex items-center gap-1">
          <Timer size={10} className="shrink-0" />
          <span>{specs.flightTimeMin}min</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px]">⚖</span>
          <span>{specs.auwGrams}g</span>
        </div>
        <div className="flex items-center gap-1">
          {specs.hasGps ? (
            <Navigation size={10} className="text-green-400 shrink-0" />
          ) : (
            <Navigation size={10} className="text-text-quaternary shrink-0" />
          )}
          <span>{specs.hasGps ? "GPS" : t("buildPreset.noGps")}</span>
        </div>
      </div>

      {/* Feature badges */}
      <div className="flex gap-1 mt-2">
        {specs.hasCompute && (
          <span className="px-1.5 py-0.5 text-[8px] font-mono bg-accent-primary/15 text-accent-primary border border-accent-primary/30">
            COMPUTE
          </span>
        )}
        {specs.hasRangefinder && (
          <span className="px-1.5 py-0.5 text-[8px] font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            LIDAR
          </span>
        )}
        {specs.hasCompass && (
          <span className="px-1.5 py-0.5 text-[8px] font-mono bg-sky-500/15 text-sky-400 border border-sky-500/30">
            MAG
          </span>
        )}
      </div>
    </div>
  );
}
