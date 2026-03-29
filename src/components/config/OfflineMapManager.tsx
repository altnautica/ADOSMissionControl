/**
 * @module OfflineMapManager
 * @description Cache statistics and management UI for Settings > Data page.
 * Shows tile count, cache size, caching toggle, and clear button.
 * @license GPL-3.0-only
 */
"use client";

import { useState, useEffect, useCallback } from "react";
import { getCacheStats, clearAllTiles, MAX_CACHE_SIZE } from "@/lib/tile-cache";
import { formatBytes } from "@/lib/tile-math";
import { useSettingsStore } from "@/stores/settings-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, WifiOff, HardDrive } from "lucide-react";

export function OfflineMapManager() {
  const [stats, setStats] = useState({ tileCount: 0, totalBytes: 0 });
  const [loading, setLoading] = useState(true);
  const [clearing, setClearing] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  const cachingEnabled = useSettingsStore((s) => s.offlineTileCaching);
  const setCachingEnabled = useSettingsStore((s) => s.setOfflineTileCaching);

  // Load cache stats
  const refreshStats = useCallback(async () => {
    const s = await getCacheStats();
    setStats(s);
    setLoading(false);
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
    if (!confirm("Clear all cached map tiles? This cannot be undone.")) return;
    setClearing(true);
    await clearAllTiles();
    await refreshStats();
    setClearing(false);
  }, [refreshStats]);

  const usagePct = MAX_CACHE_SIZE > 0 ? (stats.totalBytes / MAX_CACHE_SIZE) * 100 : 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Offline warning */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-3 py-2 bg-status-warning/10 border border-status-warning/30 rounded-lg">
          <WifiOff size={14} className="text-status-warning" />
          <span className="text-xs text-status-warning">
            You are offline. Cached tiles will be used for maps.
          </span>
        </div>
      )}

      <Card title="Offline Map Cache" padding={true}>
        <div className="flex flex-col gap-3">
          {/* Usage bar */}
          <div>
            <div className="flex justify-between text-[10px] font-mono text-text-secondary mb-1">
              <span>{loading ? "..." : formatBytes(stats.totalBytes)}</span>
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
              <span>{loading ? "..." : stats.tileCount.toLocaleString()} tiles cached</span>
            </div>
          </div>

          {/* Caching toggle */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-primary">Tile caching</span>
            <button
              onClick={() => setCachingEnabled(!cachingEnabled)}
              className={`relative w-8 h-4 rounded-full transition-colors cursor-pointer ${
                cachingEnabled ? "bg-accent-primary" : "bg-bg-tertiary border border-border-default"
              }`}
            >
              <div
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-text-primary transition-transform ${
                  cachingEnabled ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Clear button */}
          <Button
            variant="secondary"
            size="sm"
            icon={<Trash2 size={12} />}
            onClick={handleClear}
            disabled={clearing || stats.tileCount === 0}
          >
            {clearing ? "Clearing..." : "Clear All Cache"}
          </Button>

          <p className="text-[9px] text-text-tertiary">
            Download map tiles for offline use from the Plan tab (Download button in toolbar).
            Tiles are cached in your browser and available without internet.
          </p>
        </div>
      </Card>
    </div>
  );
}
