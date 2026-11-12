/**
 * @module TileLayerSwitcher
 * @description Replaces the static TileLayer with a switchable tile source.
 * Renders the active basemap (raster tiles through Leaflet, vector tiles
 * through MapLibre) and a small control button to pick between the built-in
 * basemaps and an operator-supplied ("custom") tile server. The catalog
 * itself lives in `@/lib/tile-math` so the picker, the minimap selector and
 * the offline downloader cannot drift. Persists selection to settings-store.
 * Tiles are cached by the service worker (`public/sw.js`). Also carries the
 * no-fly zone overlay toggle.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useMap } from "react-leaflet";
import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";
import {
  BASEMAP_ORDER,
  basemapLabel,
  fieldPackProvider,
  rasterZoomOptions,
  resolveBasemap,
  validateTileUrlTemplate,
} from "@/lib/tile-math";
import { useFieldTilePacks } from "@/hooks/use-field-tile-packs";
import { activeFieldPack, useFieldPackStore } from "@/stores/field-pack-store";
import { useTileHealthStore } from "@/stores/tile-health-store";
import { CustomTileSourceEditor } from "./CustomTileSourceEditor";
import L from "leaflet";
import { VectorBasemapLayer } from "./VectorBasemapLayer";
import { NoFlyZoneOverlay } from "./NoFlyZoneOverlay";
import type { NoFlyDataState } from "./NoFlyZoneOverlay";
import { NO_FLY_ZONES_BY_REGION, noFlyZonesForRegion } from "@/lib/no-fly-zones";
import { COMMON_REGIONS, normalizeRegionCode } from "@/lib/operating-region";
import { Select } from "@/components/ui/select";
import { BasemapSwitcher } from "./BasemapSwitcher";
import { MapControl } from "./MapControl";
import { useTranslations } from "next-intl";

interface ManagedTileLayerProps {
  url: string;
  attribution: string;
  maxZoom: number;
  subdomains: string[];
  /**
   * Request tiles with `crossOrigin="anonymous"` so the service worker gets a
   * readable response it may cache. False for an operator-supplied server,
   * which usually sends no CORS header: an `anonymous` <img> then fails to
   * load at all.
   */
  crossOrigin: boolean;
}

/** Tile layer rebuilt whenever the source changes, so each source brings its
 *  own maxZoom and attribution rather than inheriting the first one's. */
function ManagedTileLayer({ url, attribution, maxZoom, subdomains, crossOrigin }: ManagedTileLayerProps) {
  const map = useMap();
  const subdomainKey = subdomains.join("");

  useEffect(() => {
    useTileHealthStore.getState().observe(url);
    const layer = L.tileLayer(url, {
      attribution,
      // `maxZoom` is the server's depth: deeper zooms stretch its last tiles.
      ...rasterZoomOptions(maxZoom),
      crossOrigin,
      // Leaflet's default `abc` would leave a four-shard CDN's `d` unused.
      ...(subdomainKey ? { subdomains: subdomainKey } : {}),
    });
    try {
      layer.addTo(map);
      layer.on("tileload", () => useTileHealthStore.getState().recordLoad());
      layer.on("tileerror", (e) => {
        const tile = (e as L.TileEvent).tile as HTMLImageElement | undefined;
        useTileHealthStore.getState().recordError(tile?.src ?? null);
      });
    } catch (err) {
      console.warn("[TileLayerSwitcher] skipped stale map layer attach", err);
      return;
    }
    return () => {
      try {
        map.removeLayer(layer);
      } catch {
        /* map may already be destroyed during dev reconnect */
      }
    };
  }, [map, url, attribution, maxZoom, subdomainKey, crossOrigin]);

  return null;
}

interface TileLayerSwitcherProps {
  showControls?: boolean;
}

export function TileLayerSwitcher({ showControls = true }: TileLayerSwitcherProps) {
  const t = useTranslations("basemap");
  const source = useSettingsStore((s) => s.mapTileSource);
  const setSource = useSettingsStore((s) => s.setMapTileSource);
  const showNfz = useSettingsStore((s) => s.showNoFlyZones);
  const setShowNfz = useSettingsStore((s) => s.setShowNoFlyZones);
  const noFlyRegion = useSettingsStore((s) => s.noFlyRegion);
  const setNoFlyRegion = useSettingsStore((s) => s.setNoFlyRegion);
  const [nfzState, setNfzState] = useState<NoFlyDataState>("no-region");
  const [showPicker, setShowPicker] = useState(false);

  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const customTileMaxZoom = useSettingsStore((s) => s.customTileMaxZoom);
  const customTileAttribution = useSettingsStore((s) => s.customTileAttribution);
  const custom = useMemo(
    () => ({ url: customTileUrl, maxZoom: customTileMaxZoom, attribution: customTileAttribution }),
    [customTileUrl, customTileMaxZoom, customTileAttribution],
  );
  // A paired ground station's tile pack is offered only while one is usable.
  const fieldSource = useFieldTilePacks();
  const selectedPack = useFieldPackStore((s) => s.selectedPack);
  const setSelectedPack = useFieldPackStore((s) => s.setSelectedPack);
  const fieldPack = activeFieldPack(fieldSource, selectedPack);
  const usablePacks = fieldSource?.packs.filter((p) => p.usable) ?? [];
  const fieldProvider = useMemo(
    () => (fieldSource && fieldPack ? fieldPackProvider(fieldSource.baseUrl, fieldPack) : null),
    [fieldSource, fieldPack],
  );
  const order = fieldProvider ? [...BASEMAP_ORDER, "field-pack" as const] : BASEMAP_ORDER;
  const config = resolveBasemap(source, custom, fieldProvider);
  const fieldAuth = source === "field-pack" && fieldProvider && fieldSource
    ? { authBaseUrl: fieldSource.baseUrl, apiKey: fieldSource.apiKey }
    : {};

  const handleSelect = useCallback((s: MapTileSource) => {
    setSource(s);
    // Custom keeps the popover open: the editor below is where the operator
    // types the URL, and closing on select would hide it immediately.
    if (s !== "custom") setShowPicker(false);
  }, [setSource]);

  return (
    <>
      {config.kind === "vector" ? (
        <VectorBasemapLayer
          url={config.url}
          attribution={config.attribution}
          maxZoom={config.maxZoom}
          flavor={config.flavor ?? "dark"}
          {...fieldAuth}
        />
      ) : (
        <ManagedTileLayer
          url={config.url}
          attribution={config.attribution}
          maxZoom={config.maxZoom}
          subdomains={config.subdomains}
          crossOrigin={source !== "custom"}
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
        <MapControl className="leaflet-top leaflet-right">
          <div className="leaflet-control" style={{ marginTop: 10, marginRight: 10 }}>
            <button
              onClick={() => setShowPicker((v) => !v)}
              className="bg-bg-primary/90 backdrop-blur-md border border-border-strong rounded px-2 py-1 text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors shadow-lg"
              title="Switch map tiles"
            >
              {basemapLabel(source)}
            </button>
            {showPicker && (
              <div className="mt-1 flex w-64 flex-col gap-1 bg-bg-primary/90 backdrop-blur-md border border-border-strong rounded p-1 shadow-lg">
                {/* Shared segmented basemap switcher (matches the simulate view). */}
                <BasemapSwitcher
                  stretch
                  value={source}
                  onChange={(v) => handleSelect(v as MapTileSource)}
                  options={order.map((s) => ({ value: s, label: basemapLabel(s) }))}
                />
                {source === "field-pack" && fieldPack && (
                  <div className="flex flex-col gap-1 px-1 pb-1">
                    <span className="px-1 text-[11px] font-mono text-text-secondary">
                      {t("fieldPackActive", { name: fieldPack.name })}
                    </span>
                    {usablePacks.length > 1 && (
                      <Select
                        value={fieldPack.name}
                        onChange={(v) => setSelectedPack(v)}
                        options={usablePacks.map((p) => ({ value: p.name, label: p.name }))}
                        ariaLabel={t("fieldPackSelect")}
                      />
                    )}
                  </div>
                )}
                {source === "field-pack" && !fieldPack && (
                  <span className="px-1 text-[11px] font-mono text-status-warning">
                    {t("fieldPackUnreachable")}
                  </span>
                )}
                {/* Operator-supplied tile server. Editing it here keeps the
                    whole flow on the map; /config/data mounts the same editor. */}
                {source === "custom" && (
                  <>
                    <CustomTileSourceEditor className="px-1 pb-1" />
                    {validateTileUrlTemplate(customTileUrl) !== null && (
                      <span className="px-1 text-[9px] font-mono text-status-warning">
                        Custom map URL not usable. Showing DARK until it is fixed.
                      </span>
                    )}
                  </>
                )}
                {/* NFZ toggle */}
                <button
                  onClick={() => setShowNfz(!showNfz)}
                  className={`w-full px-3 py-1.5 text-[10px] font-mono transition-colors rounded-sm ${
                    showNfz
                      ? "text-status-error bg-status-error/10"
                      : "text-text-secondary hover:text-text-primary hover:bg-bg-secondary"
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
                          description:
                            NO_FLY_ZONES_BY_REGION[r.code]?.coverage ??
                            "No no-fly data in this build",
                        })),
                      ]}
                    />
                    <span className="px-1 text-[9px] font-mono text-text-secondary">
                      {nfzState === "drawn"
                        ? `Showing ${noFlyRegion} no-fly data: ${noFlyZonesForRegion(noFlyRegion)?.coverage ?? ""}`
                        : nfzState === "no-region"
                          ? "No region set. Nothing is drawn, and that is not a clear-airspace result"
                          : `No no-fly data for ${noFlyRegion} in this build. Nothing is drawn`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </MapControl>
      )}
    </>

  );
}
