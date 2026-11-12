/**
 * @module MapControlsPanel
 * @description Map controls for the 3D simulation viewer: imagery mode toggle,
 * buildings checkbox, terrain exaggeration slider, path/camera-trigger toggles,
 * and a rounded-turns display-smoothing toggle.
 * Positioned in the top-left corner of the viewer.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useSettingsStore } from "@/stores/settings-store";
import { cn } from "@/lib/utils";
import { BasemapSwitcher } from "@/components/map/BasemapSwitcher";
import { useState } from "react";
import { ChevronDown } from "lucide-react";

/** Viewport width from which the panel starts open. */
export const MAP_CONTROLS_OPEN_MIN_WIDTH = 1200;

function startsOpen(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(`(min-width: ${MAP_CONTROLS_OPEN_MIN_WIDTH}px)`).matches;
}

interface MapControlsPanelProps {
  hasIonToken: boolean;
  /** Corner placement classes; defaults to the top-left corner. */
  placement?: string;
}

export function MapControlsPanel({ hasIonToken, placement = "top-4 left-4" }: MapControlsPanelProps) {
  const t = useTranslations("simulate");
  const imageryMode = useSettingsStore((s) => s.cesiumImageryMode);
  const setImageryMode = useSettingsStore((s) => s.setCesiumImageryMode);
  const quality = useSettingsStore((s) => s.cesiumQuality);
  const setQuality = useSettingsStore((s) => s.setCesiumQuality);
  const buildingsEnabled = useSettingsStore((s) => s.cesiumBuildingsEnabled);
  const setBuildingsEnabled = useSettingsStore((s) => s.setCesiumBuildingsEnabled);
  const terrainExaggeration = useSettingsStore((s) => s.terrainExaggeration);
  const setTerrainExaggeration = useSettingsStore((s) => s.setTerrainExaggeration);
  const showLabels = useSettingsStore((s) => s.showPathLabels);
  const setShowLabels = useSettingsStore((s) => s.setShowPathLabels);
  const showCameraTriggers = useSettingsStore((s) => s.showCameraTriggers);
  const setShowCameraTriggers = useSettingsStore((s) => s.setShowCameraTriggers);
  const roundedTurns = useSettingsStore((s) => s.roundedTurnsPreview);
  const setRoundedTurns = useSettingsStore((s) => s.setRoundedTurnsPreview);

  const buildingsDisabled = !hasIonToken;
  // On a narrow window the open panel covers the HUD and the view, so it
  // starts collapsed there; the header opens it.
  const [open, setOpen] = useState(startsOpen);

  return (
    <div className={cn("absolute z-10 flex flex-col gap-2 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg", placement)}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-6 items-center justify-center gap-1 text-[9px] font-mono text-text-tertiary hover:text-text-primary cursor-pointer"
      >
        {t("map")}
        <ChevronDown size={10} className={cn("transition-transform", open ? "rotate-180" : "")} />
      </button>

      {open && (
      <>

      {/* Imagery / basemap — shared segmented switcher (matches the planner). */}
      <BasemapSwitcher
        stretch
        value={imageryMode}
        onChange={(v) => setImageryMode(v as "dark" | "satellite")}
        options={[
          { value: "dark", label: t("dark") },
          { value: "satellite", label: t("satelliteShort") },
        ]}
      />

      {/* Quality toggle */}
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-mono text-text-secondary">{t("quality")}</span>
        <div className="flex gap-1">
          <button
            onClick={() => setQuality("balanced")}
            className={cn(
              "h-7 rounded text-[10px] font-mono font-bold flex-1 transition-colors cursor-pointer",
              quality === "balanced"
                ? "bg-accent-primary text-bg-primary"
                : "text-text-secondary hover:text-text-primary border border-border-default"
            )}
          >
            {t("qualityBalanced")}
          </button>
          <button
            onClick={() => setQuality("high")}
            className={cn(
              "h-7 rounded text-[10px] font-mono font-bold flex-1 transition-colors cursor-pointer",
              quality === "high"
                ? "bg-accent-primary text-bg-primary"
                : "text-text-secondary hover:text-text-primary border border-border-default"
            )}
          >
            {t("qualityHigh")}
          </button>
        </div>
      </div>

      {/* Buildings checkbox */}
      <label
        className={cn(
          "flex items-center gap-1.5 text-[10px] font-mono text-text-secondary",
          buildingsDisabled && "opacity-50"
        )}
        title={
          buildingsDisabled
            ? t("requiresCesiumIonToken")
            : t("toggle3dBuildings")
        }
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

      {/* Path labels checkbox */}
      <label className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary">
        <input
          type="checkbox"
          checked={showLabels}
          onChange={(e) => setShowLabels(e.target.checked)}
          className="w-3 h-3 rounded accent-accent-primary"
        />
        {t("labels")}
      </label>

      {/* Camera trigger markers checkbox */}
      <label className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary">
        <input
          type="checkbox"
          checked={showCameraTriggers}
          onChange={(e) => setShowCameraTriggers(e.target.checked)}
          className="w-3 h-3 rounded accent-accent-primary"
        />
        {t("cameraTriggers")}
      </label>

      {/* Rounded-turns display preview (cosmetic smoothing, default off) */}
      <div className="flex flex-col gap-0.5">
        <label
          className="flex items-center gap-1.5 text-[10px] font-mono text-text-secondary"
          title={t("roundedTurns.hint")}
        >
          <input
            type="checkbox"
            checked={roundedTurns}
            onChange={(e) => setRoundedTurns(e.target.checked)}
            className="w-3 h-3 rounded accent-accent-primary"
          />
          {t("roundedTurns.label")}
        </label>
        <span className="pl-[18px] text-[9px] font-mono text-text-tertiary leading-tight">
          {t("roundedTurns.subtitle")}
        </span>
      </div>
      </>
      )}
    </div>
  );
}
