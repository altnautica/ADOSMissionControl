/**
 * @module MapControlsPanel
 * @description Map controls for the 3D simulation viewer: imagery mode toggle,
 * buildings checkbox, terrain exaggeration slider, and path label toggle.
 * Positioned in the top-left corner of the viewer.
 * @license GPL-3.0-only
 */

"use client";

import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";

interface MapControlsPanelProps {
  hasIonToken: boolean;
}

export function MapControlsPanel({ hasIonToken }: MapControlsPanelProps) {
  const imageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const setImageryMode = useSettingsStore((s) => s.setCesiumImageryMode);
  const buildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const setBuildingsEnabled = useSettingsStore((s) => s.setCesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const setTerrainExaggeration = useSettingsStore((s) => s.setTerrainExaggeration);
  const showLabels = useSettingsStore((s) => s.showPathLabels);
  const setShowLabels = useSettingsStore((s) => s.setShowPathLabels);

  const buildingsDisabled = !hasIonToken;

  return (
    <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg">
      <span className="text-[9px] font-mono text-text-tertiary text-center">MAP</span>

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
          onClick={() => setImageryMode("satellite")}
          title="Satellite imagery"
          className={cn(
            "h-7 rounded text-[10px] font-mono font-bold flex-1 transition-colors cursor-pointer",
            imageryMode === "satellite"
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
        title={
          buildingsDisabled
            ? "Requires Cesium Ion token"
            : "Toggle 3D buildings"
        }
      >
        <input
          type="checkbox"
          checked={buildingsEnabled}
          disabled={buildingsDisabled}
          onChange={(e) => setBuildingsEnabled(e.target.checked)}
          className="w-3 h-3 rounded accent-accent-primary"
        />
        Buildings
      </label>

      {/* Terrain exaggeration slider */}
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-text-secondary">Terrain</span>
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

      {/* Path labels checkbox */}
      <label className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary">
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(e) => setShowLabels(e.target.checked)}
          className="w-3 h-3 rounded accent-accent-primary"
        />
        Labels
      </label>
    </div>
  );
}
