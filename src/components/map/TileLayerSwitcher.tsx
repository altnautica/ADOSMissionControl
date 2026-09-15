/**
 * @module TileLayerSwitcher
 * @description Replaces the static TileLayer with a switchable tile source.
 * Renders the active tile layer and a small control button to cycle between
 * CARTO Dark, OpenStreetMap, and Esri Satellite imagery. Persists selection
 * to settings-store. Supports offline tile caching via IndexedDB and
 * no-fly zone overlay toggle.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useMap } from "react-leaflet";
import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";
import L from "leaflet";
import { CachedTileLayer } from "./CachedTileLayer";
import { NoFlyZoneOverlay } from "./NoFlyZoneOverlay";
import type { NoFlyDataState } from "./NoFlyZoneOverlay";
import { NO_FLY_ZONES_BY_REGION } from "@/lib/no-fly-zones";
import { COMMON_REGIONS, normalizeRegionCode } from "@/lib/operating-region";
import { Select } from "@/components/ui/select";
import { BasemapSwitcher } from "./BasemapSwitcher";

interface TileConfig {
  url: string;
  attribution: string;
  maxZoom: number;
}

const TILE_CONFIGS: Record<MapTileSource, TileConfig> = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
    maxZoom: 20,
  },
  osm: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>',
    maxZoom: 18,
  },
  terrain: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
    maxZoom: 17,
  },
};

const TILE_LABELS: Record<MapTileSource, string> = {
  dark: "DARK",
  osm: "OSM",
  satellite: "SAT",
  terrain: "TOPO",
};

const TILE_ORDER: MapTileSource[] = ["dark", "osm", "satellite", "terrain"];

/** TileLayer that uses setUrl() on source change instead of unmounting/remounting.
 *  Preserves loaded tiles during transition for smoother switching. */
function ManagedTileLayer({ url, attribution, maxZoom }: { url: string; attribution: string; maxZoom: number }) {
  const map = useMap();
  const layerRef = useRef<L.TileLayer | null>(null);
  const initialUrlRef = useRef(url);

  // Create layer once on mount
  useEffect(() => {
    const layer = L.tileLayer(initialUrlRef.current, { attribution, maxZoom });
    try {
      layer.addTo(map);
      layerRef.current = layer;
    } catch (err) {
      console.warn("[TileLayerSwitcher] skipped stale map layer attach", err);
      return;
    }
    return () => {
      if (layerRef.current) {
        try {
          map.removeLayer(layerRef.current);
        } catch {
          /* map may already be destroyed during dev reconnect */
        }
        layerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Update URL without remounting
  useEffect(() => {
    if (layerRef.current && layerRef.current.getTileUrl !== undefined) {
      layerRef.current.setUrl(url);
    }
  }, [url]);

  return null;
}

interface TileLayerSwitcherProps {
  showControls?: boolean;
}

export function TileLayerSwitcher({ showControls = true }: TileLayerSwitcherProps) {
  const source = useSettingsStore((s) => s.mapTileSource);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  const cachingEnabled = useSettingsStore((s) => s.offlineTileCaching);
  const showNfz = useSettingsStore((s) => s.showNoFlyZones);
  const setShowNfz = useSettingsStore((s) => s.setShowNoFlyZones);
  const noFlyRegion = useSettingsStore((s) => s.noFlyRegion);
  const setNoFlyRegion = useSettingsStore((s) => s.setNoFlyRegion);
  const [nfzState, setNfzState] = useState<NoFlyDataState>("no-region");
  const [showPicker, setShowPicker] = useState(false);

  const config = TILE_CONFIGS[source] ?? TILE_CONFIGS.dark;

  const handleSelect = useCallback((s: MapTileSource) => {
    setSource(s);
    setShowPicker(false);
  }, [setSource]);

  return (
    <>
      {cachingEnabled ? (
        <CachedTileLayer
          url={config.url}
          attribution={config.attribution}
          maxZoom={config.maxZoom}
        />
      ) : (
        <ManagedTileLayer
          url={config.url}
          attribution={config.attribution}
          maxZoom={config.maxZoom}
        />
      )}

      {/* No-fly zone overlay. It draws only for a region this build carries
          data for, and reports what it resolved to so the control below can
          say "no data" instead of leaving an empty layer reading as clear. */}
      <NoFlyZoneOverlay
        visible={showControls && showNfz}
        region={noFlyRegion}
        onDataState={setNfzState}
      />

      {/* Layer switcher control — top right */}
      {showControls && (
        <div className="leaflet-top leaflet-right" style={{ pointerEvents: "auto" }}>
          <div className="leaflet-control" style={{ marginTop: 10, marginRight: 10 }}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="bg-bg-primary/90 backdrop-blur-md border border-border-strong rounded px-2 py-1 text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors shadow-lg"
              title="Switch map tiles"
            >
              {TILE_LABELS[source] ?? "MAP"}
            </button>
            {showPicker && (
              <div className="mt-1 flex flex-col gap-1 bg-bg-primary/90 backdrop-blur-md border border-border-strong rounded p-1 shadow-lg">
                {/* Shared segmented basemap switcher (matches the simulate view). */}
                <BasemapSwitcher
                  stretch
                  value={source}
                  onChange={(v) => handleSelect(v as MapTileSource)}
                  options={TILE_ORDER.map((s) => ({ value: s, label: TILE_LABELS[s] }))}
                />
                {/* NFZ toggle */}
                <button
                  onClick={() => setShowNfz(!showNfz)}
                  className={`w-full px-3 py-1.5 text-[10px] font-mono transition-colors rounded-sm ${
                    showNfz
                      ? "text-status-error bg-status-error/10"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                  }`}
                >
                  {showNfz ? "NFZ ON" : "NFZ OFF"}
                </button>
                {/* What the layer resolved to, and the region it used. Without
                    this an operator cannot tell an empty dataset from clear
                    airspace, which is the failure this replaces. */}
                {showNfz && (
                  <div className="flex flex-col gap-1 px-1 pb-1">
                    <Select
                      value={noFlyRegion ?? ""}
                      onChange={(v) =>
                        setNoFlyRegion(v === "" ? null : normalizeRegionCode(v))
                      }
                      options={[
                        { value: "", label: "Region not set" },
                        ...COMMON_REGIONS.map((r) => ({
                          value: r.code,
                          label: `${r.code} — ${r.name}`,
                          description: NO_FLY_ZONES_BY_REGION[r.code]
                            ? undefined
                            : "No no-fly data in this build",
                        })),
                      ]}
                    />
                    <span className="px-1 text-[9px] font-mono text-text-secondary">
                      {nfzState === "drawn"
                        ? `Showing ${noFlyRegion} no-fly data`
                        : nfzState === "no-region"
                          ? "No region set. Nothing is drawn, and that is not a clear-airspace result"
                          : `No no-fly data for ${noFlyRegion} in this build. Nothing is drawn`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>

  );
}
