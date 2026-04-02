/**
 * @module ViewportStatsOverlay
 * @description Bottom-left stats bar showing visible zones, airports,
 * zoom level, and altitude. Compact horizontal layout.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { Plane, MapPin, Radio } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";
import { useTrafficStore } from "@/stores/traffic-store";
import { cn } from "@/lib/utils";

function formatAltitude(m: number): string {
  if (m > 1_000_000) return `${(m / 1_000_000).toFixed(1)}Mm`;
  if (m > 1_000) return `${(m / 1_000).toFixed(0)}km`;
  return `${m.toFixed(0)}m`;
}

export function ViewportStatsOverlay() {
  const t = useTranslations("airTraffic");
  const viewportState = useAirspaceStore((s) => s.viewportState);
  const aircraft = useTrafficStore((s) => s.aircraft);
  const dataSource = useTrafficStore((s) => s.dataSource);
  const connectionQuality = useTrafficStore((s) => s.connectionQuality);
  const lastUpdate = useTrafficStore((s) => s.lastUpdate);
  const displayMode = useTrafficStore((s) => s.displayMode);

  const freshness = lastUpdate ? `${Math.round((Date.now() - lastUpdate) / 1000)}s` : "-";

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2.5 py-1.5 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg text-[9px] font-mono text-text-secondary">
      {/* Aircraft count (viewport / total) */}
      <div className="flex items-center gap-1" title={t("aircraftInViewport", { inView: viewportState.aircraftInView, total: aircraft.size })}>
        <Plane size={9} className="text-text-tertiary" />
        <span className="text-text-primary font-bold">{viewportState.aircraftInView}</span>
        <span className="text-text-tertiary">/</span>
        <span className="text-text-secondary">{aircraft.size}</span>
      </div>

      <div className="w-px h-3 bg-border-default/50" />

      {/* Visible airports */}
      <div className="flex items-center gap-1" title={t("airportsInViewport")}>
        <MapPin size={9} className="text-text-tertiary" />
        <span>{viewportState.visibleAirports.length}</span>
      </div>

      <div className="w-px h-3 bg-border-default/50" />

      {/* Zoom / altitude */}
      <span title={t("cameraAltitude")} className="text-text-tertiary">
        {formatAltitude(viewportState.cameraAlt)}
      </span>

      <div className="w-px h-3 bg-border-default/50" />

      {/* Display mode */}
      <span className="text-text-tertiary capitalize" title={t("displayMode")}>
        {displayMode}
      </span>

      <div className="w-px h-3 bg-border-default/50" />

      {/* Source + freshness */}
      <div className="flex items-center gap-1" title={`Source: ${dataSource || "offline"}`}>
        <Radio size={9} className="text-text-tertiary" />
        <span className={cn(
          "w-1.5 h-1.5 rounded-full",
          connectionQuality === "good" && "bg-green-400",
          connectionQuality === "degraded" && "bg-yellow-400",
          connectionQuality === "disconnected" && "bg-red-400",
        )} />
        <span className="text-text-tertiary">{freshness}</span>
      </div>
    </div>
  );
}
