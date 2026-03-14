/**
 * @module StatsOverlay
 * @description Collapsible traffic stats overlay positioned top-right.
 * Shows aircraft count, altitude band breakdown, threat counts, data source,
 * and connection quality at a glance.
 * @license GPL-3.0-only
 */

"use client";

import { useState } from "react";
import { BarChart3, ChevronDown, ChevronUp } from "lucide-react";
import { useTrafficStore } from "@/stores/traffic-store";
import { useAirspaceStore } from "@/stores/airspace-store";
import { cn } from "@/lib/utils";

export function StatsOverlay() {
  const [collapsed, setCollapsed] = useState(true);
  const aircraft = useTrafficStore((s) => s.aircraft);
  const dataSource = useTrafficStore((s) => s.dataSource);
  const connectionQuality = useTrafficStore((s) => s.connectionQuality);
  const lastUpdate = useTrafficStore((s) => s.lastUpdate);
  const threatLevels = useTrafficStore((s) => s.threatLevels);
  const zones = useAirspaceStore((s) => s.zones);

  const hasOpenAIP = zones.some((z) => z.metadata?.source === "openaip");
  const allAircraft = Array.from(aircraft.values());
  const total = allAircraft.length;

  // Altitude bands (meters)
  const low = allAircraft.filter((a) => (a.altitudeMsl ?? 0) < 1500).length;
  const med = allAircraft.filter((a) => (a.altitudeMsl ?? 0) >= 1500 && (a.altitudeMsl ?? 0) < 5000).length;
  const high = allAircraft.filter((a) => (a.altitudeMsl ?? 0) >= 5000).length;

  // Threat counts
  const threats = Array.from(threatLevels.values());
  const raCount = threats.filter((t) => t === "ra").length;
  const taCount = threats.filter((t) => t === "ta").length;

  const freshness = lastUpdate ? `${Math.round((Date.now() - lastUpdate) / 1000)}s` : "-";

  return (
    <div className="absolute top-[10.5rem] right-4 z-10">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className={cn(
          "flex items-center gap-1.5 px-2 py-1.5 rounded-lg",
          "bg-bg-primary/70 backdrop-blur-md border border-border-default",
          "text-[10px] font-mono text-text-secondary hover:text-text-primary transition-colors cursor-pointer",
        )}
      >
        <BarChart3 size={10} className="text-text-tertiary" />
        <span className="font-bold">{total}</span>
        {total === 0 && connectionQuality === "good" && (
          <span className="text-text-tertiary text-[8px] hidden sm:inline">no aircraft in range</span>
        )}
        <span className={cn(
          "w-1.5 h-1.5 rounded-full",
          connectionQuality === "good" && "bg-green-400",
          connectionQuality === "degraded" && "bg-yellow-400",
          connectionQuality === "disconnected" && "bg-red-400",
        )} />
        {collapsed ? <ChevronDown size={10} /> : <ChevronUp size={10} />}
      </button>

      {!collapsed && (
        <div className="mt-1 p-2 rounded-lg bg-bg-primary/80 backdrop-blur-md border border-border-default min-w-[140px]">
          <div className="space-y-1.5 text-[9px] font-mono">
            {total === 0 && connectionQuality === "good" && (
              <div className="text-text-tertiary text-center py-1">
                No aircraft in range. Try panning to a different area.
              </div>
            )}
            {/* Altitude bands */}
            <div className="text-text-tertiary uppercase tracking-wider">Altitude</div>
            <div className="flex justify-between text-text-secondary">
              <span>&lt;1500m</span>
              <span className="text-text-primary">{low}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>1.5-5km</span>
              <span className="text-text-primary">{med}</span>
            </div>
            <div className="flex justify-between text-text-secondary">
              <span>&gt;5km</span>
              <span className="text-text-primary">{high}</span>
            </div>

            {/* Threats */}
            {(raCount > 0 || taCount > 0) && (
              <>
                <div className="border-t border-border-default/50 pt-1.5 text-text-tertiary uppercase tracking-wider">
                  Threats
                </div>
                {raCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-red-400">RA</span>
                    <span className="text-red-400 font-bold">{raCount}</span>
                  </div>
                )}
                {taCount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-orange-400">TA</span>
                    <span className="text-orange-400 font-bold">{taCount}</span>
                  </div>
                )}
              </>
            )}

            {/* Source + freshness */}
            <div className="border-t border-border-default/50 pt-1.5 flex justify-between text-text-tertiary">
              <span>{dataSource || "offline"}</span>
              <span>{freshness}</span>
            </div>

            {hasOpenAIP && (
              <div className="border-t border-border-default/50 pt-1.5 text-text-tertiary text-center">
                Airspace:{" "}
                <a
                  href="https://www.openaip.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent-primary hover:underline"
                >
                  OpenAIP
                </a>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
