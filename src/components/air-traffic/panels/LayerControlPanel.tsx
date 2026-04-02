/**
 * @module LayerControlPanel
 * @description Left-side collapsible panel for toggling airspace and restriction
 * layer visibility on the Air Traffic globe.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { Layers, ChevronLeft, ChevronRight } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";
import type { AirTrafficLayers } from "@/lib/airspace/types";

const LAYER_GROUPS: { key: keyof AirTrafficLayers; label: string; description: string }[] = [
  { key: "airspace", label: "Airspace", description: "Controlled zones, classes B-E" },
  { key: "restrictions", label: "Restrictions", description: "TFRs, NOTAMs, temporary zones" },
  { key: "advisory", label: "Advisory", description: "MOAs, stadiums, parks" },
  { key: "ownDrone", label: "Own Drone", description: "Your drone position" },
  { key: "terrain", label: "Terrain", description: "3D terrain and exaggeration" },
];

export function LayerControlPanel() {
  const t = useTranslations("airTraffic");
  const [collapsed, setCollapsed] = useState(false);
  const layerVisibility = useAirspaceStore((s) => s.layerVisibility);
  const setLayerVisibility = useAirspaceStore((s) => s.setLayerVisibility);
  const activeJurisdictions = useAirspaceStore((s) => s.activeJurisdictions);
  const toggleJurisdiction = useAirspaceStore((s) => s.toggleJurisdiction);
  const showIcaoZones = useAirspaceStore((s) => s.showIcaoZones);
  const setShowIcaoZones = useAirspaceStore((s) => s.setShowIcaoZones);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-4 left-4 z-10 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer"
        title={t("showLayerControls")}
      >
        <ChevronRight size={14} className="text-text-secondary" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 left-4 z-10 w-48 bg-bg-primary/80 backdrop-blur-md border border-border-default rounded-lg overflow-hidden max-h-[calc(100vh-14rem)] overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-1.5">
          <Layers size={12} className="text-text-tertiary" />
          <span className="text-[10px] font-mono font-bold text-text-secondary uppercase tracking-wider">
            {t("layers")}
          </span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <ChevronLeft size={12} />
        </button>
      </div>

      {/* Layer toggles */}
      <div className="p-2 flex flex-col gap-1">
        {LAYER_GROUPS.map(({ key, label, description }) => (
          <label
            key={key}
            className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-bg-secondary/50 transition-colors cursor-pointer group"
            title={description}
          >
            <input
              type="checkbox"
              checked={layerVisibility[key]}
              onChange={(e) => setLayerVisibility(key, e.target.checked)}
              className="w-3 h-3 rounded accent-accent-primary shrink-0"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-[11px] font-mono text-text-primary truncate">
                {label}
              </span>
              <span className="text-[9px] text-text-tertiary truncate group-hover:text-text-secondary transition-colors">
                {description}
              </span>
            </div>
          </label>
        ))}
      </div>

      {/* Jurisdiction filters */}
      <div className="px-2 pt-1 pb-2 border-t border-border-default mt-1">
        <span className="text-[9px] font-mono text-text-tertiary uppercase px-2">{t("jurisdictions")}</span>
        <div className="flex flex-col gap-1 mt-1">
          {(Object.keys(JURISDICTIONS) as Jurisdiction[]).map((j) => (
            <label
              key={j}
              className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-secondary/50 transition-colors cursor-pointer"
            >
              <input
                type="checkbox"
                checked={activeJurisdictions.has(j)}
                onChange={() => toggleJurisdiction(j)}
                className="w-3 h-3 rounded accent-accent-primary shrink-0"
              />
              <span className="text-[11px] font-mono text-text-primary">
                {JURISDICTIONS[j].flag} {JURISDICTIONS[j].name}
              </span>
            </label>
          ))}
          <label
            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-bg-secondary/50 transition-colors cursor-pointer"
          >
            <input
              type="checkbox"
              checked={showIcaoZones}
              onChange={(e) => setShowIcaoZones(e.target.checked)}
              className="w-3 h-3 rounded accent-accent-primary shrink-0"
            />
            <span className="text-[11px] font-mono text-text-primary">
              ICAO (Global)
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
