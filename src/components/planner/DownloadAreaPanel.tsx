/**
 * @module DownloadAreaPanel
 * @description Panel for configuring and executing offline map tile downloads
 * for the CURRENT MAP VIEW. Opens from the map toolbar and caches the tiles
 * covering the current viewport bounds (there is no rectangle-draw tool — the
 * download area is whatever the map currently shows). Displays the tile
 * provider, zoom range, tile count, size estimate, and download progress.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useMemo, useCallback } from "react";
import { X, CloudDownload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import {
  totalTileCount, estimateDownloadSize, formatBytes,
  BASEMAP_ORDER, basemapName, resolveBasemap, validateTileUrlTemplate,
  type LatLngBounds,
} from "@/lib/tile-math";
import { MAX_CACHE_SIZE } from "@/lib/tile-cache";
import { useTileDownloadStore } from "@/stores/tile-download-store";
import { useSettingsStore, type MapTileSource } from "@/stores/settings-store";

interface DownloadAreaPanelProps {
  bounds: LatLngBounds;
  currentZoom: number;
  currentProvider: MapTileSource;
  onClose: () => void;
}

export function DownloadAreaPanel({ bounds, currentZoom, currentProvider, onClose }: DownloadAreaPanelProps) {
  const customTileUrl = useSettingsStore((s) => s.customTileUrl);
  const customTileMaxZoom = useSettingsStore((s) => s.customTileMaxZoom);
  const customTileAttribution = useSettingsStore((s) => s.customTileAttribution);
  const custom = useMemo(
    () => ({ url: customTileUrl, maxZoom: customTileMaxZoom, attribution: customTileAttribution }),
    [customTileUrl, customTileMaxZoom, customTileAttribution],
  );
  const customUsable = validateTileUrlTemplate(customTileUrl) === null;
  // Downloading CDN tiles for a custom source would cache them under the CDN's
  // URLs — a 100% miss for the on-screen custom layer, and internet traffic for
  // an operator who chose a self-hosted server precisely to avoid it.
  const [provider, setProvider] = useState<MapTileSource>(
    currentProvider === "custom" && !customUsable ? "dark" : currentProvider,
  );
  const providerConfig = resolveBasemap(provider, custom);
  const maxZoomForProvider = providerConfig.maxZoom;
  const customSelectedButUnusable = provider === "custom" && !customUsable;

  // Sensible default: current zoom to +4, capped at provider max
  const defaultMinZoom = Math.max(1, Math.round(currentZoom));
  const defaultMaxZoom = Math.min(defaultMinZoom + 4, maxZoomForProvider);

  const [zoomMin, setZoomMin] = useState(defaultMinZoom);
  const [zoomMax, setZoomMax] = useState(defaultMaxZoom);

  const isDownloading = useTileDownloadStore((s) => s.isDownloading);
  const progress = useTileDownloadStore((s) => s.progress);
  const result = useTileDownloadStore((s) => s.result);
  const error = useTileDownloadStore((s) => s.error);
  const startDownload = useTileDownloadStore((s) => s.startDownload);
  const cancelDownload = useTileDownloadStore((s) => s.cancelDownload);
  const clearResult = useTileDownloadStore((s) => s.clearResult);

  // Calculate estimates
  const tileCount = useMemo(
    () => totalTileCount(bounds, zoomMin, zoomMax),
    [bounds, zoomMin, zoomMax],
  );
  const estSize = useMemo(
    () => estimateDownloadSize(bounds, zoomMin, zoomMax, providerConfig.avgTileKB),
    [bounds, zoomMin, zoomMax, providerConfig.avgTileKB],
  );

  const isLarge = tileCount > 50000;
  const wouldExceedCache = estSize > MAX_CACHE_SIZE;

  const handleDownload = useCallback(async () => {
    // Auto-enable caching if disabled
    const settings = useSettingsStore.getState();
    if (!settings.offlineTileCaching) {
      settings.setOfflineTileCaching(true);
    }
    clearResult();
    await startDownload(bounds, zoomMin, zoomMax, providerConfig);
  }, [bounds, zoomMin, zoomMax, providerConfig, startDownload, clearResult]);

  const handleClose = useCallback(() => {
    if (isDownloading) cancelDownload();
    onClose();
  }, [isDownloading, cancelDownload, onClose]);

  const progressPct = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;

  return (
    <div className="absolute top-24 left-14 z-[1001] w-72 bg-bg-secondary/95 backdrop-blur-sm border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-2">
          <CloudDownload size={12} className="text-accent-primary" />
          <span className="text-[11px] font-mono font-semibold text-text-primary">
            Download Current View
          </span>
        </div>
        <button onClick={handleClose} className="text-text-tertiary hover:text-text-primary cursor-pointer">
          <X size={12} />
        </button>
      </div>

      <div className="px-3 py-2 flex flex-col gap-2.5">
        {/* Honest scope: this caches the tiles for the current map viewport,
            not a separately-drawn rectangle. */}
        <p className="text-[9px] text-text-tertiary leading-snug">
          Caches offline tiles covering the current map view.
        </p>
        {/* Provider */}
        <div>
          <label className="text-[9px] text-text-tertiary uppercase font-mono">Tile Provider</label>
          <Select
            value={provider}
            onChange={(v) => {
              const next = v as MapTileSource;
              setProvider(next);
              const newMax = resolveBasemap(next, custom).maxZoom;
              if (zoomMax > newMax) setZoomMax(newMax);
              if (zoomMin > newMax) setZoomMin(Math.max(1, newMax - 4));
            }}
            options={BASEMAP_ORDER
              .filter((s) => s !== "custom" || customUsable)
              .map((s) => ({ value: s, label: basemapName(s) }))}
            disabled={isDownloading}
          />
        </div>

        {/* Zoom range */}
        <div>
          <label className="text-[9px] text-text-tertiary uppercase font-mono">
            Zoom Range: {zoomMin} – {zoomMax}
          </label>
          <div className="flex items-center gap-2 mt-1">
            <input
              type="range"
              min={1}
              max={maxZoomForProvider}
              value={zoomMin}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomMin(v);
                if (v > zoomMax) setZoomMax(v);
              }}
              className="flex-1 h-1 accent-accent-primary"
              disabled={isDownloading}
            />
            <input
              type="range"
              min={1}
              max={maxZoomForProvider}
              value={zoomMax}
              onChange={(e) => {
                const v = Number(e.target.value);
                setZoomMax(v);
                if (v < zoomMin) setZoomMin(v);
              }}
              className="flex-1 h-1 accent-accent-primary"
              disabled={isDownloading}
            />
          </div>
        </div>

        {/* Estimates */}
        <div className="flex justify-between text-[10px] font-mono">
          <span className="text-text-secondary">Tiles: {tileCount.toLocaleString()}</span>
          <span className="text-text-secondary">~{formatBytes(estSize)}</span>
        </div>

        {/* Warnings */}
        {isLarge && !isDownloading && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 bg-status-warning/10 border border-status-warning/30 rounded">
            <AlertTriangle size={12} className="text-status-warning shrink-0 mt-0.5" />
            <span className="text-[9px] text-status-warning">
              Large download ({tileCount.toLocaleString()} tiles). This may take a while.
            </span>
          </div>
        )}
        {wouldExceedCache && !isDownloading && (
          <div className="flex items-start gap-1.5 px-2 py-1.5 bg-status-warning/10 border border-status-warning/30 rounded">
            <AlertTriangle size={12} className="text-status-warning shrink-0 mt-0.5" />
            <span className="text-[9px] text-status-warning">
              May exceed cache limit ({formatBytes(MAX_CACHE_SIZE)}). Oldest tiles will be evicted.
            </span>
          </div>
        )}

        {/* Download progress */}
        {isDownloading && (
          <div className="flex flex-col gap-1">
            <div className="w-full h-1.5 bg-bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all duration-200"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="flex justify-between text-[9px] font-mono text-text-tertiary">
              <span>{progress.completed.toLocaleString()} / {progress.total.toLocaleString()}</span>
              <span>{formatBytes(progress.bytes)}</span>
            </div>
            {progress.skipped > 0 && (
              <span className="text-[9px] font-mono text-text-tertiary">
                {progress.skipped} already cached
              </span>
            )}
          </div>
        )}

        {/* Result */}
        {result && !isDownloading && (
          <div className="px-2 py-1.5 bg-status-success/10 border border-status-success/30 rounded">
            <span className="text-[9px] text-status-success">
              Downloaded {result.completed.toLocaleString()} tiles ({formatBytes(result.totalBytes)})
              {result.skipped > 0 && `, ${result.skipped} already cached`}
              {result.failed > 0 && `, ${result.failed} failed`}
            </span>
          </div>
        )}

        {/* Error */}
        {error && !isDownloading && (
          <div className="px-2 py-1.5 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[9px] text-status-error">{error}</span>
          </div>
        )}

        {/* Belt-and-braces: the select filters this option out, but a stale
            `currentProvider` can still seed it. */}
        {customSelectedButUnusable && !isDownloading && (
          <div className="px-2 py-1.5 bg-status-error/10 border border-status-error/30 rounded">
            <span className="text-[9px] text-status-error">
              Set a usable custom tile URL before downloading.
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-border-default flex gap-2">
        {isDownloading ? (
          <Button variant="secondary" size="sm" onClick={cancelDownload} className="w-full">
            Cancel
          </Button>
        ) : (
          <>
            <Button variant="secondary" size="sm" onClick={handleClose} className="flex-1">
              Close
            </Button>
            <Button variant="primary" size="sm" onClick={handleDownload} className="flex-1"
              disabled={customSelectedButUnusable}
              icon={<CloudDownload size={12} />}>
              Download
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
