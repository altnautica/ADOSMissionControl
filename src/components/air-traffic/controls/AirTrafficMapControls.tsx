/**
 * @module AirTrafficMapControls
 * @description Map controls for the Air Traffic 3D viewer: imagery mode toggle,
 * buildings checkbox, terrain exaggeration slider.
 * Reuses pattern from simulation/MapControlsPanel.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";

interface AirTrafficMapControlsProps {
  hasIonToken: boolean;
}

export function AirTrafficMapControls({ hasIonToken }: AirTrafficMapControlsProps) {
  const t = useTranslations("airTraffic");
  const imageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const setImageryMode = useSettingsStore((s) => s.setCesiumImageryMode);
  const buildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const setBuildingsEnabled = useSettingsStore((s) => s.setCesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const setTerrainExaggeration = useSettingsStore((s) => s.setTerrainExaggeration);
  const dataSource = useTrafficStore((s) => s.dataSource);
  const connectionQuality = useTrafficStore((s) => s.connectionQuality);

  const satDisabled = !hasIonToken;
  const buildingsDisabled = !hasIonToken;

  return (
    <div className="absolute bottom-14 left-4 z-10 flex flex-col gap-2 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg">
      <span className="text-[9px] font-mono text-text-tertiary text-center">{t("map")}</span>

      {/* Imagery toggle */}
      <div className="flex gap-1">
        <button
          onClick={() => setImageryMode("dark")}
          className={cn(
            "h-7 rounded text-[10px] font-mono font-bold flex-1 transition-colors cursor-pointer",
            imageryMode === "dark"
              ? "bg-accent-primary text-bg-primary"
              : "text-text-secondary hover:text-text-primary border border-border-default"
          )}
        >
          Dark
        </button>
        <button
          onClick={() => !satDisabled && setImageryMode("satellite")}
          title={satDisabled ? t("requiresIonToken") : t("satelliteImagery")}
          className={cn(
            "h-7 rounded text-[10px] font-mono font-bold flex-1 transition-colors",
            satDisabled && "opacity-50 cursor-not-allowed",
            !satDisabled && "cursor-pointer",
            imageryMode === "satellite" && !satDisabled
              ? "bg-accent-primary text-bg-primary"
              : "text-text-secondary hover:text-text-primary border border-border-default"
          )}
        >
          Sat
        </button>
      </div>

      {/* Buildings checkbox */}
      <label
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-mono text-text-secondary",
          buildingsDisabled && "opacity-50"
        )}
        title={buildingsDisabled ? t("requiresIonToken") : t("toggle3DBuildings")}
      >
        <input
          type="checkbox"
          checked={buildingsEnabled}
          disabled={buildingsDisabled}
          onChange={(e) => setBuildingsEnabled(e.target.checked)}
          className="w-3 h-3 rounded accent-accent-primary"
        />
        {t("buildings")}
      </label>

      {/* Terrain exaggeration slider */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-text-secondary">{t("terrain")}</span>
          <span className="text-[10px] font-mono text-text-tertiary">{terrainExaggeration}x</span>
        </div>
        <input
          type="range"
          min={1}
          max={5}
          step={0.5}
          value={terrainExaggeration}
          onChange={(e) => setTerrainExaggeration(parseFloat(e.target.value))}
          className="w-full h-1 rounded-full appearance-none bg-border-default accent-accent-primary cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary"
        />
      </div>

      {/* Data source + connection quality */}
      <div className="flex items-center gap-1.5 pt-1 border-t border-border-default/50 mt-1">
        <span className={cn(
          "w-2 h-2 rounded-full shrink-0",
          connectionQuality === "good" && "bg-green-400",
          connectionQuality === "degraded" && "bg-yellow-400",
          connectionQuality === "disconnected" && "bg-red-400",
        )} />
        <span className="text-[9px] font-mono text-text-tertiary truncate">{dataSource || "offline"}</span>
      </div>
    </div>
  );
}
