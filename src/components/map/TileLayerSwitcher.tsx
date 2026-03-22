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
import dynamic from "next/dynamic";
import type L from "leaflet";

const CachedTileLayer = dynamic(
  () => import("./CachedTileLayer").then((m) => ({ default: m.CachedTileLayer })),
  { ssr: false }
);
const NoFlyZoneOverlay = dynamic(
  () => import("./NoFlyZoneOverlay").then((m) => ({ default: m.NoFlyZoneOverlay })),
  { ssr: false }
);

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
    let layer: L.TileLayer | null = null;
    import("leaflet").then((L) => {
      layer = L.tileLayer(initialUrlRef.current, { attribution, maxZoom });
      layer.addTo(map);
      layerRef.current = layer;
    });
    return () => {
      if (layerRef.current) {
        map.removeLayer(layerRef.current);
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

export function TileLayerSwitcher() {
  const source = useSettingsStore((s) => s.mapTileSource);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  const cachingEnabled = useSettingsStore((s) => s.offlineTileCaching);
  const showNfz = useSettingsStore((s) => s.showNoFlyZones);
  const setShowNfz = useSettingsStore((s) => s.setShowNoFlyZones);
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

      {/* No-fly zone overlay */}
      <NoFlyZoneOverlay visible={showNfz} />

      {/* Layer switcher control — top right */}
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
            <div className="mt-1 bg-bg-primary/90 backdrop-blur-md border border-border-strong rounded shadow-lg">
              {TILE_ORDER.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSelect(s)}
                  className={`block w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors rounded-sm ${
                    s === source
                      ? "text-accent-primary bg-surface-secondary"
                      : "text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                  }`}
                >
                  {TILE_LABELS[s]}
                </button>
              ))}
              {/* Separator + NFZ toggle */}
              <div className="border-t border-border-strong my-0.5" />
              <button
                onClick={() => setShowNfz(!showNfz)}
                className={`block w-full text-left px-3 py-1.5 text-[10px] font-mono transition-colors rounded-sm ${
                  showNfz
                    ? "text-status-error bg-status-error/10"
                    : "text-text-secondary hover:text-text-primary hover:bg-surface-secondary"
                }`}
              >
                {showNfz ? "NFZ ON" : "NFZ OFF"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
