/**
 * @module ViewportStatsOverlay
 * @description Bottom-left stats bar showing visible zones, airports,
 * zoom level, and altitude. Compact horizontal layout.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { useAirspaceStore } from "@/stores/airspace-store";

function formatAltitude(m: number): string {
  if (m > 1_000_000) return `${(m / 1_000_000).toFixed(1)}Mm`;
  if (m > 1_000) return `${(m / 1_000).toFixed(0)}km`;
  return `${m.toFixed(0)}m`;
}

export function ViewportStatsOverlay() {
  const t = useTranslations("airTraffic");
  const viewportState = useAirspaceStore((s) => s.viewportState);
  const zones = useAirspaceStore((s) => s.zones);

  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-2.5 py-1.5 bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg text-[9px] font-mono text-text-secondary">
      {/* Zone count */}
      <div className="flex items-center gap-1" title={t("activeZonesLabel")}>
        <span className="text-text-primary font-bold">{zones.length}</span>
        <span className="text-text-tertiary">zones</span>
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
    </div>
  );
}
