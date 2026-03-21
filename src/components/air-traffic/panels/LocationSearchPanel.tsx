/**
 * @module LocationSearchPanel
 * @description Address/coordinate search with fly-to functionality.
 * Uses Nominatim geocoding API for address lookup.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useState, useCallback } from "react";
import { Search, MapPin, X } from "lucide-react";
import { Cartesian3, type Viewer as CesiumViewer } from "cesium";

interface LocationSearchPanelProps {
  viewer: CesiumViewer | null;
}

interface SearchResult {
  lat: number;
  lon: number;
  displayName: string;
}

export function LocationSearchPanel({ viewer }: LocationSearchPanelProps) {
  const t = useTranslations("airTraffic");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const handleSearch = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    // Check if input looks like coordinates (lat,lon)
    const coordMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lon = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        flyTo(lat, lon);
        setResults([]);
        return;
      }
    }

    // Nominatim geocoding
    setLoading(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(trimmed)}&format=json&limit=5`;
      const res = await fetch(url, {
        headers: { "User-Agent": "ADOSMissionControl/1.0" },
      });
      if (!res.ok) throw new Error("Geocoding failed");
      const data = await res.json();
      setResults(
        data.map((r: { lat: string; lon: string; display_name: string }) => ({
          lat: parseFloat(r.lat),
          lon: parseFloat(r.lon),
          displayName: r.display_name,
        }))
      );
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const flyTo = useCallback(
    (lat: number, lon: number) => {
      if (!viewer || viewer.isDestroyed()) return;
      viewer.camera.flyTo({
        destination: Cartesian3.fromDegrees(lon, lat, 50000),
        duration: 1.5,
      });
      viewer.scene.requestRender();
      setOpen(false);
      setResults([]);
    },
    [viewer]
  );

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="absolute top-4 right-4 z-10 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer"
        title={t("searchLocation")}
      >
        <Search size={14} className="text-text-secondary" />
      </button>
    );
  }

  return (
    <div className="absolute top-4 right-4 z-20 w-72 bg-bg-primary/90 backdrop-blur-md border border-border-default rounded-lg overflow-hidden shadow-xl">
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-default">
        <Search size={12} className="text-text-tertiary shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          placeholder={t("addressOrCoords")}
          className="flex-1 bg-transparent text-xs font-mono text-text-primary placeholder:text-text-tertiary outline-none"
          autoFocus
        />
        <button
          onClick={() => { setOpen(false); setResults([]); setQuery(""); }}
          className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <X size={12} />
        </button>
      </div>

      {/* Results */}
      {loading && (
        <div className="px-3 py-2 text-[10px] font-mono text-text-tertiary">{t("searching")}</div>
      )}
      {results.length > 0 && (
        <div className="max-h-48 overflow-y-auto">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => flyTo(r.lat, r.lon)}
              className="flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-bg-secondary/50 transition-colors cursor-pointer border-b border-border-default/30"
            >
              <MapPin size={10} className="text-text-tertiary shrink-0 mt-0.5" />
              <span className="text-[10px] font-mono text-text-secondary leading-tight">
                {r.displayName}
              </span>
            </button>
          ))}
        </div>
      )}
      {!loading && results.length === 0 && query.trim() && (
        <div className="px-3 py-2 text-[10px] font-mono text-text-tertiary">
          {t("pressEnterToSearch")}
        </div>
      )}
    </div>
  );
}
