/**
 * @module FlightSearchPanel
 * @description Top-left search panel for filtering and locating aircraft by
 * callsign, registration, ICAO24, type, or origin country.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Search, X, ChevronDown, ChevronUp } from "lucide-react";
import { Cartesian3, type Viewer as CesiumViewer } from "cesium";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";

interface FlightSearchPanelProps {
  viewer: CesiumViewer | null;
}

export function FlightSearchPanel({ viewer }: FlightSearchPanelProps) {
  const t = useTranslations("airTraffic");
  const [collapsed, setCollapsed] = useState(true);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const aircraft = useTrafficStore((s) => s.aircraft);
  const setSelectedAircraft = useTrafficStore((s) => s.setSelectedAircraft);

  const results = useMemo(() => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    const matches: Array<{ icao24: string; callsign: string | null; lat: number; lon: number; alt: number | null; country: string; reg?: string; type?: string }> = [];

    for (const ac of aircraft.values()) {
      if (matches.length >= 20) break;
      const fields = [
        ac.callsign?.toLowerCase(),
        ac.icao24.toLowerCase(),
        ac.originCountry.toLowerCase(),
        ac.registration?.toLowerCase(),
        ac.aircraftType?.toLowerCase(),
      ];
      if (fields.some((f) => f?.includes(q))) {
        matches.push({
          icao24: ac.icao24,
          callsign: ac.callsign,
          lat: ac.lat,
          lon: ac.lon,
          alt: ac.altitudeMsl,
          country: ac.originCountry,
          reg: ac.registration,
          type: ac.aircraftType,
        });
      }
    }
    return matches;
  }, [query, aircraft]);

  const flyToAircraft = useCallback(
    (icao24: string, lat: number, lon: number, alt: number | null) => {
      setSelectedAircraft(icao24);
      if (viewer && !viewer.isDestroyed()) {
        viewer.camera.flyTo({
          destination: Cartesian3.fromDegrees(lon, lat, (alt ?? 1000) + 5000),
          duration: 1.5,
        });
      }
    },
    [viewer, setSelectedAircraft]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && results.length > 0) {
        const r = results[0];
        flyToAircraft(r.icao24, r.lat, r.lon, r.alt);
      }
    },
    [results, flyToAircraft]
  );

  useEffect(() => {
    if (!collapsed && inputRef.current) {
      inputRef.current.focus();
    }
  }, [collapsed]);

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="absolute top-4 left-56 z-10 p-2 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg hover:bg-bg-secondary transition-colors cursor-pointer flex items-center gap-1.5"
        title={t("searchAircraft")}
      >
        <Search size={12} className="text-text-secondary" />
        <span className="text-[9px] font-mono text-text-tertiary">{aircraft.size}</span>
      </button>
    );
  }

  return (
    <div className="absolute top-4 left-56 z-10 w-56 bg-bg-primary/80 backdrop-blur-md border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b border-border-default">
        <Search size={11} className="text-text-tertiary shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("searchPlaceholder")}
          className="flex-1 bg-transparent text-[11px] font-mono text-text-primary placeholder:text-text-tertiary outline-none min-w-0"
        />
        <span className="text-[9px] font-mono text-text-tertiary shrink-0">{aircraft.size}</span>
        {query && (
          <button onClick={() => setQuery("")} className="text-text-tertiary hover:text-text-primary cursor-pointer">
            <X size={10} />
          </button>
        )}
        <button
          onClick={() => { setCollapsed(true); setQuery(""); }}
          className="text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          <ChevronUp size={10} />
        </button>
      </div>

      {/* Results */}
      {query.trim() && (
        <div className="max-h-60 overflow-y-auto">
          {results.length === 0 && (
            <div className="px-3 py-4 text-[10px] font-mono text-text-tertiary text-center">
              {t("noMatches")}
            </div>
          )}
          {results.map((r) => (
            <button
              key={r.icao24}
              onClick={() => flyToAircraft(r.icao24, r.lat, r.lon, r.alt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-secondary/50 transition-colors cursor-pointer text-left border-b border-border-default/30"
            >
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-[11px] font-mono text-text-primary truncate">
                  {r.callsign?.trim() || r.icao24.toUpperCase()}
                </span>
                <span className="text-[9px] font-mono text-text-tertiary truncate">
                  {[r.type, r.reg, r.country].filter(Boolean).join(" / ")}
                </span>
              </div>
              <ChevronDown size={9} className="text-text-tertiary rotate-[-90deg] shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
