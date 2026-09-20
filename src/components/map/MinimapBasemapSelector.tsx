"use client";

/**
 * @module map/MinimapBasemapSelector
 * @description A compact map-type selector for the cockpit minimap — the basemap
 * segments only (DARK / OSM / SAT / TOPO, plus CUSTOM once configured), with no
 * NFZ toggle and no click-to-expand. It writes the shared `mapTileSource`
 * setting, so both the minimap and the full map follow the choice. The basemap
 * catalog is shared from `@/lib/tile-math`, a pure module, so importing this
 * client component still pulls no Leaflet into an SSR pass.
 * @license GPL-3.0-only
 */

import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";
import { BASEMAP_ORDER, basemapLabel, validateTileUrlTemplate } from "@/lib/tile-math";
import { BasemapSwitcher } from "./BasemapSwitcher";

export function MinimapBasemapSelector({ className }: { className?: string }) {
  const source = useSettingsStore((s) => s.mapTileSource);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  // This surface carries no editor, so an unconfigured custom source would be
  // a segment that selects a fallback basemap. Hide it until it is usable.
  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const customUsable = validateTileUrlTemplate(customTileUrl) === null;
  const options = BASEMAP_ORDER
    .filter((s) => s !== "custom" || customUsable || source === "custom")
    .map((s) => ({ value: s, label: basemapLabel(s) }));
  return (
    <BasemapSwitcher
      className={className}
      value={source}
      onChange={(v) => setSource(v as MapTileSource)}
      options={options}
    />
  );
}
