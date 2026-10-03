/**
 * @module OfflineMapManager
 * @description Cache statistics and management UI for Settings > Data page.
 * Shows tile count, cache size, caching toggle, and clear button.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { getCacheStats, clearAllTiles, MAX_CACHE_SIZE } from "@/lib/tile-cache";
import { formatBytes } from "@/lib/tile-math";
import { useSettingsStore } from "@/stores/settings-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import { Trash2, WifiOff, HardDrive } from "lucide-react";
import { CustomTileSourceEditor } from "@/components/map/CustomTileSourceEditor";

/** IndexedDB can hang (blocked upgrade, private mode); stop waiting after this. */
const CACHE_STATS_TIMEOUT_MS = 5_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => reject(new Error("Tile cache did not respond")), ms);
  work.then(resolve, reject).finally(() => clearTimeout(timer));
  return promise;
}

export function OfflineMapManager() {
  const t = useTranslations("offlineMapManager");
  const [stats, setStats] = useState({ tileCount: 0, totalBytes: 0 });
  const [loading, setLoading] = useState(true);
  const [cacheError, setCacheError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const cachingEnabled = useSettingsStore((s) => s.offlineTileCaching);
  const setCachingEnabled = useSettingsStore((s) => s.setOfflineTileCaching);

  // Load cache stats
  const refreshStats = useCallback(async () => {
    try {
      setStats(await withTimeout(getCacheStats(), CACHE_STATS_TIMEOUT_MS));
      setCacheError(null);
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  // Online/offline detection
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  const handleClear = useCallback(async () => {
    if (!confirm(t("clearConfirm"))) return;
    setClearing(true);
    try {
      await clearAllTiles();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      await refreshStats();
      setClearing(false);
    }
  }, [refreshStats, t]);

  const usagePct = MAX_CACHE_SIZE > 0 ? (stats.totalBytes / MAX_CACHE_SIZE) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Offline warning */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 rounded-lg">
          <WifiOff size={14} className="text-status-warning" />
          <span className="text-xs text-status-warning">{t("offlineWarning")}</span>
        </div>
      )}

      {/* Operator-supplied basemap. This is the only map-settings surface in
          /config, and it is where an operator sets up offline use — the map
          popover alone is unreachable on /plan before a plan exists. */}
      <Card title={t("customSourceTitle")} padding={true}>
        <CustomTileSourceEditor />
      </Card>

      <Card title={t("cacheTitle")} padding={true}>
        <div className="flex flex-col gap-3">
          {/* Usage bar */}
          <div>
            <div className="flex justify-between text-[10px] font-mono text-text-secondary mb-1">
              <span>{loading ? "..." : cacheError ? "—" : formatBytes(stats.totalBytes)}</span>
              <span>{formatBytes(MAX_CACHE_SIZE)}</span>
            </div>
            <div className="w-full h-2 bg-bg-tertiary rounded overflow-hidden">
              <div
                className="h-full bg-accent-primary transition-all"
                style={{ width: `${Math.min(usagePct, 100)}%` }}
              />
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 text-[10px] font-mono text-text-secondary">
            <div className="flex items-center gap-1">
              <HardDrive size={10} />
              <span>
                {t("tilesCached", {
                  count: loading ? "..." : cacheError ? "—" : stats.tileCount.toLocaleString(),
                })}
              </span>
            </div>
          </div>
          {cacheError && (
            <p className="text-[10px] text-status-error">{t("unavailable", { error: cacheError })}</p>
          )}

          {/* Caching toggle */}
          <Toggle
            label={t("tileCaching")}
            checked={cachingEnabled}
            onChange={setCachingEnabled}
          />

          {/* Clear button */}
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 size={12} />}
            onClick={handleClear}
            disabled={clearing || stats.tileCount === 0}
          >
            {clearing ? t("clearing") : t("clearAll")}
          </Button>

          <p className="text-[9px] text-text-tertiary">{t("help")}</p>
        </div>
      </Card>
    </div>
  );
}
