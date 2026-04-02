/**
 * @module AirportDetailPanel
 * @description Auto-shows when zoomed into a single airport (<50km altitude).
 * Displays airport info, active zones, and jurisdiction-specific rules.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { useState, useMemo } from "react";
import { Plane, X, ChevronDown, ChevronUp } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { JURISDICTIONS, type Jurisdiction } from "@/lib/jurisdiction";
import type { Airport } from "@/lib/airspace/airport-database";

interface AirportDetailPanelProps {
  airport: Airport;
}

const DRONE_RULES: Record<string, string> = {
  IN: "DGCA rules: Nano (<250g) exempt from registration. Micro (250g-2kg) needs UIN. Max 120m AGL. Digital Sky for permissions in Yellow zones. Red zones are no-fly.",
  US: "FAA Part 107: Max 400ft AGL, VLOS only, daylight/twilight. LAANC authorization needed in controlled airspace. Register at faadronezone.faa.gov.",
  AU: "CASA excluded category (<2kg): Max 120m AGL, VLOS, not over people, 5.5km from controlled aerodromes. Heavier drones need ReOC.",
};

function getJurisdictionForCountry(country: string): Jurisdiction | null {
  switch (country) {
    case "IN": return "dgca";
    case "US": return "faa";
    case "AU": return "casa";
    default: return null;
  }
}

export function AirportDetailPanel({ airport }: AirportDetailPanelProps) {
  const t = useTranslations("airTraffic");
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const zones = useAirspaceStore((s) => s.zones);
  const aircraft = useTrafficStore((s) => s.aircraft);

  const jurisdiction = getJurisdictionForCountry(airport.country);
  const jConfig = jurisdiction ? JURISDICTIONS[jurisdiction] : null;

  // Active zones affecting this airport
  const activeZones = useMemo(
    () => zones.filter((z) => z.metadata.icao === airport.icao),
    [zones, airport.icao],
  );

  // Nearby traffic count (within 25km)
  const nearbyTraffic = useMemo(() => {
    const R = 6371000;
    const toRad = Math.PI / 180;
    let count = 0;
    for (const ac of aircraft.values()) {
      if (!ac.lat || !ac.lon) continue;
      const dLat = (ac.lat - airport.lat) * toRad;
      const dLon = (ac.lon - airport.lon) * toRad;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(airport.lat * toRad) * Math.cos(ac.lat * toRad) * Math.sin(dLon / 2) ** 2;
      const d = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      if (d < 25_000) count++;
    }
    return count;
  }, [aircraft, airport.lat, airport.lon]);

  if (dismissed) return null;

  return (
    <div className="absolute bottom-16 right-[20rem] z-10 w-56 bg-bg-primary/80 backdrop-blur-md border border-border-default rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <div className="flex items-center gap-1.5 min-w-0">
          <Plane size={12} className="text-accent-primary shrink-0" />
          <span className="text-[10px] font-mono font-bold text-text-primary truncate">
            {airport.icao} / {airport.iata}
          </span>
          {jConfig && (
            <span className="text-[10px] shrink-0">{jConfig.flag}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            {expanded ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="p-0.5 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            <X size={10} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-2 space-y-2 text-[10px] font-mono">
          {/* Airport info */}
          <div>
            <div className="text-text-primary font-bold truncate">{airport.name}</div>
            <div className="text-text-tertiary">{airport.municipality}</div>
          </div>

          <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-text-secondary">
            <span>{t("elevation")}</span>
            <span className="text-text-primary text-right">{airport.elevation}m</span>
            <span>{t("type")}</span>
            <span className="text-text-primary text-right capitalize">{airport.type.replace("_", " ")}</span>
            <span>{t("traffic")}</span>
            <span className="text-text-primary text-right">{t("nearbyCount", { count: nearbyTraffic })}</span>
          </div>

          {/* Active zones */}
          {activeZones.length > 0 && (
            <div className="border-t border-border-default/50 pt-1.5">
              <div className="text-[9px] text-text-tertiary uppercase tracking-wider mb-1">{t("activeZonesLabel")}</div>
              <div className="space-y-0.5">
                {activeZones.map((z) => (
                  <div key={z.id} className="flex justify-between text-text-secondary">
                    <span className="truncate mr-1">{z.type}</span>
                    <span className="text-text-primary shrink-0">
                      {z.ceilingAltitude > 0 ? `${z.ceilingAltitude}m` : "No-fly"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Drone rules */}
          {DRONE_RULES[airport.country] && (
            <div className="border-t border-border-default/50 pt-1.5">
              <div className="text-[9px] text-text-tertiary uppercase tracking-wider mb-1">{t("droneRules")}</div>
              <p className="text-text-secondary leading-relaxed text-[9px]">
                {DRONE_RULES[airport.country]}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
