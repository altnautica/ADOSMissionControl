/**
 * @module LandingPointPicker
 * @description Reusable landing-point coordinate picker for the landing pattern
 * config sections. Provides numeric latitude/longitude inputs plus a
 * "Use map center" button that reads the current planner map center.
 * @license GPL-3.0-only
 */
"use client";

import { useTranslations } from "next-intl";
import { NumericField } from "@/components/ui/numeric-field";
import { usePlannerStore } from "@/stores/planner-store";
import { Plane, Crosshair } from "lucide-react";

interface LandingPointPickerProps {
  /** Current landing point as [lat, lon], or undefined when not yet set. */
  landingPoint: [number, number] | undefined;
  /** Called with the next [lat, lon] whenever either coordinate changes. */
  onChange: (point: [number, number]) => void;
}

export function LandingPointPicker({ landingPoint, onChange }: LandingPointPickerProps) {
  const t = useTranslations("planner");

  const lat = landingPoint?.[0];
  const lon = landingPoint?.[1];

  // A coordinate entered before the point exists pairs with the map centre's
  // other coordinate rather than 0 (the equator / prime meridian).
  const setLat = (v: number) => {
    onChange([v, lon ?? usePlannerStore.getState().mapCenter[1]]);
  };
  const setLon = (v: number) => {
    onChange([lat ?? usePlannerStore.getState().mapCenter[0], v]);
  };
  const useMapCenter = () => {
    const center = usePlannerStore.getState().mapCenter;
    onChange([center[0], center[1]]);
  };

  return (
    <>
      <div className="flex items-center gap-1.5 text-[10px] font-mono text-text-tertiary">
        <Plane size={12} />
        <span>
          {landingPoint
            ? `${t("landingPoint")}: ${lat!.toFixed(5)}, ${lon!.toFixed(5)}`
            : t("setLandingPoint")}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumericField
          label={t("lat")}
          value={lat}
          min={-90}
          max={90}
          step="any"
          placeholder="—"
          onCommit={setLat}
        />
        <NumericField
          label={t("lon")}
          value={lon}
          min={-180}
          max={180}
          step="any"
          placeholder="—"
          onCommit={setLon}
        />
      </div>
      <button
        onClick={useMapCenter}
        className="flex items-center justify-center gap-2 py-1.5 text-xs font-mono
          text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/10
          transition-colors cursor-pointer"
      >
        <Crosshair size={12} />
        {t("useMapCenter")}
      </button>
    </>
  );
}
