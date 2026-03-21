/**
 * @module AirspaceInfoPanel
 * @description Click-anywhere zone details panel with "Can I Fly?" verdict.
 * Shows active zones, altitude limits, NOTAMs, nearest airport, traffic count,
 * and jurisdiction-specific guidance with CTA links.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { X, CheckCircle, AlertTriangle, XCircle, ExternalLink, MapPin } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { cn } from "@/lib/utils";
import type { Flyability, FlyabilityVerdict } from "@/lib/airspace/types";

const VERDICT_CONFIG: Record<FlyabilityVerdict, { icon: typeof CheckCircle; color: string; bg: string; labelKey: string }> = {
  clear: {
    icon: CheckCircle,
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/30",
    labelKey: "clearToFly",
  },
  advisory: {
    icon: AlertTriangle,
    color: "text-yellow-400",
    bg: "bg-yellow-500/10 border-yellow-500/30",
    labelKey: "advisoriesActive",
  },
  restricted: {
    icon: XCircle,
    color: "text-red-400",
    bg: "bg-red-500/10 border-red-500/30",
    labelKey: "flightRestricted",
  },
};

export function AirspaceInfoPanel() {
  const t = useTranslations("airTraffic");
  const flyability = useAirspaceStore((s) => s.flyability);
  const selectedPoint = useAirspaceStore((s) => s.selectedPoint);
  const setSelectedPoint = useAirspaceStore((s) => s.setSelectedPoint);
  const setFlyability = useAirspaceStore((s) => s.setFlyability);

  if (!flyability || !selectedPoint) return null;

  const config = VERDICT_CONFIG[flyability.verdict];
  const Icon = config.icon;

  return (
    <div className="absolute top-16 right-14 z-20 w-80 bg-bg-primary/90 backdrop-blur-md border border-border-default rounded-lg overflow-hidden shadow-xl">
      {/* Verdict header */}
      <div className={cn("flex items-center gap-2 px-4 py-3 border-b", config.bg)}>
        <Icon size={18} className={config.color} />
        <div className="flex-1 min-w-0">
          <p className={cn("text-sm font-semibold", config.color)}>{t(config.labelKey)}</p>
          <p className="text-[10px] font-mono text-text-tertiary">
            {selectedPoint.lat.toFixed(5)}, {selectedPoint.lon.toFixed(5)}
          </p>
        </div>
        <button
          onClick={() => { setSelectedPoint(null); setFlyability(null); }}
          className="p-1 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>

      {/* Details */}
      <div className="p-3 flex flex-col gap-3 max-h-[400px] overflow-y-auto">
        {/* Max altitude */}
        <div>
          <p className="text-[9px] font-mono text-text-tertiary uppercase mb-1">{t("maxAltitude")}</p>
          <p className="text-sm font-mono text-text-primary font-bold">
            {flyability.maxAltitudeAgl > 0 ? `${flyability.maxAltitudeAgl}m AGL` : t("noFlightPermitted")}
          </p>
        </div>

        {/* Active zones */}
        {flyability.zones.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-text-tertiary uppercase mb-1">
              {t("activeZones", { count: flyability.zones.length })}
            </p>
            <div className="flex flex-col gap-1">
              {flyability.zones.map((zone) => (
                <div key={zone.id} className="flex items-center gap-2 text-xs font-mono text-text-secondary">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: zoneColor(zone.type) }} />
                  <span className="truncate">{zone.name}</span>
                  <span className="text-text-tertiary ml-auto whitespace-nowrap">
                    {zone.floorAltitude}-{zone.ceilingAltitude}m
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Nearest airport */}
        {flyability.nearestAirport && (
          <div>
            <p className="text-[9px] font-mono text-text-tertiary uppercase mb-1">{t("nearestAirport")}</p>
            <div className="flex items-center gap-2 text-xs font-mono text-text-secondary">
              <MapPin size={10} className="text-text-tertiary shrink-0" />
              <span>{flyability.nearestAirport.name} ({flyability.nearestAirport.icao})</span>
              <span className="text-text-tertiary ml-auto">
                {flyability.nearestAirport.distanceKm.toFixed(1)} km
              </span>
            </div>
          </div>
        )}

        {/* NOTAMs */}
        {flyability.activeNotams.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-text-tertiary uppercase mb-1">
              {t("activeNotams", { count: flyability.activeNotams.length })}
            </p>
            <div className="flex flex-col gap-1">
              {flyability.activeNotams.map((notam) => (
                <div key={notam.id} className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 rounded px-2 py-1">
                  {notam.title}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TFRs */}
        {flyability.activeTfrs.length > 0 && (
          <div>
            <p className="text-[9px] font-mono text-text-tertiary uppercase mb-1">
              {t("activeTfrs", { count: flyability.activeTfrs.length })}
            </p>
            <div className="flex flex-col gap-1">
              {flyability.activeTfrs.map((tfr) => (
                <div key={tfr.id} className="text-[10px] font-mono text-red-400 bg-red-500/10 rounded px-2 py-1">
                  {tfr.name}: {tfr.description}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Traffic count */}
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-text-tertiary">{t("liveTrafficNearby")}</span>
          <span className="text-text-primary font-bold">{flyability.trafficCount}</span>
        </div>

        {/* Guidance */}
        {flyability.guidance && (
          <div className="text-[11px] font-mono text-text-secondary bg-bg-secondary/50 rounded px-3 py-2">
            {flyability.guidance}
          </div>
        )}

        {/* CTA Links */}
        {flyability.ctaLinks.length > 0 && (
          <div className="flex flex-col gap-1.5">
            {flyability.ctaLinks.map((link, i) => (
              <a
                key={i}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[11px] font-mono text-accent-primary hover:text-accent-primary/80 transition-colors"
              >
                <ExternalLink size={10} className="shrink-0" />
                {link.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function zoneColor(type: string): string {
  const map: Record<string, string> = {
    classB: "#3A82FF", classC: "#C850C0", classD: "#3A82FF", classE: "#C850C0",
    restricted: "#3A82FF", prohibited: "#FF4444", moa: "#FF8C00", tfr: "#FF4444",
    dgcaGreen: "#44FF44", dgcaYellow: "#FFDD44", dgcaRed: "#FF4444",
    casaRestricted: "#FF4444", casaCaution: "#FF8C00",
  };
  return map[type] ?? "#888";
}
