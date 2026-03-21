/**
 * @module TerrainProfileChart
 * @description Terrain elevation profile chart overlaid with flight altitude.
 * Shows ground elevation in brown/earth and flight path in blue.
 * Supports toggle between "Relative to Takeoff" and "Terrain Following (AGL)" views.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Mountain, Loader2 } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import type { TerrainProfile } from "@/lib/terrain/types";
import { haversineDistance } from "@/lib/telemetry-utils";
import { computeTerrainProfile } from "@/lib/terrain/terrain-profile";
import { MAP_COLORS } from "@/lib/map-constants";

/** Terrain profile chart colors. */
const TERRAIN_FILL = "#8B6914";
const TERRAIN_STROKE = "#6B5010";

/** Merged data point for the combined chart. */
interface ChartDataPoint {
  distance: number;
  distanceLabel: string;
  terrainElevation: number;
  flightAltitude: number;
  agl: number;
}

interface TerrainProfileChartProps {
  waypoints: Waypoint[];
}

export function TerrainProfileChart({ waypoints }: TerrainProfileChartProps) {
  const t = useTranslations("terrain");
  const [terrainProfile, setTerrainProfile] = useState<TerrainProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"relative" | "terrain">("terrain");
  const abortRef = useRef<AbortController | null>(null);

  // Fetch terrain profile when waypoints change (debounced)
  useEffect(() => {
    if (waypoints.length < 2) {
      setTerrainProfile(null);
      return;
    }

    // Cancel previous request
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const timer = setTimeout(() => {
      setLoading(true);
      computeTerrainProfile(waypoints, 5, controller.signal)
        .then((profile) => {
          if (!controller.signal.aborted) {
            setTerrainProfile(profile);
            setLoading(false);
          }
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") {
            console.warn("[terrain-chart] Profile fetch failed:", err);
            setLoading(false);
          }
        });
    }, 500);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [waypoints]);

  // Build chart data
  const data: ChartDataPoint[] = useMemo(() => {
    if (!terrainProfile || terrainProfile.points.length === 0 || waypoints.length < 2) {
      return [];
    }

    // For each terrain point, interpolate the flight altitude at that distance
    let totalDist = 0;
    const wpDistances: number[] = [0];
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversineDistance(
        waypoints[i - 1].lat, waypoints[i - 1].lon,
        waypoints[i].lat, waypoints[i].lon,
      );
      wpDistances.push(totalDist);
    }

    return terrainProfile.points.map((tp) => {
      // Find which segment this distance falls in
      let flightAlt = waypoints[0].alt;
      for (let i = 1; i < wpDistances.length; i++) {
        if (tp.distance <= wpDistances[i]) {
          const segStart = wpDistances[i - 1];
          const segEnd = wpDistances[i];
          const segLen = segEnd - segStart;
          const t = segLen > 0 ? (tp.distance - segStart) / segLen : 0;
          flightAlt = waypoints[i - 1].alt + (waypoints[i].alt - waypoints[i - 1].alt) * t;
          break;
        }
        flightAlt = waypoints[waypoints.length - 1].alt;
      }

      // In terrain mode, flight altitude is ground elevation + waypoint AGL
      const terrainElev = tp.elevation;
      const displayFlightAlt = mode === "terrain"
        ? terrainElev + flightAlt
        : flightAlt;

      return {
        distance: Math.round(tp.distance),
        distanceLabel: tp.distance >= 1000
          ? `${(tp.distance / 1000).toFixed(1)}`
          : `${Math.round(tp.distance)}`,
        terrainElevation: Math.round(terrainElev),
        flightAltitude: Math.round(displayFlightAlt),
        agl: Math.round(displayFlightAlt - terrainElev),
      };
    });
  }, [terrainProfile, waypoints, mode]);

  const toggleMode = useCallback(() => {
    setMode((m) => (m === "relative" ? "terrain" : "relative"));
  }, []);

  if (waypoints.length < 2) return null;

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {/* Mode toggle */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Mountain size={12} className="text-text-tertiary" />
          <span className="text-[10px] font-mono text-text-tertiary">
            {mode === "terrain" ? t("terrainFollowingAgl") : t("relativeToTakeoff")}
          </span>
        </div>
        <button
          onClick={toggleMode}
          className="text-[10px] font-mono text-accent-primary hover:text-accent-primary/80 cursor-pointer"
        >
          {mode === "terrain" ? t("showRelative") : t("showTerrain")}
        </button>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex items-center justify-center h-[80px]">
          <Loader2 size={14} className="text-text-tertiary animate-spin" />
          <span className="text-[10px] text-text-tertiary ml-2">{t("loadingTerrain")}</span>
        </div>
      )}

      {/* Legend */}
      {!loading && data.length > 0 && (
        <div className="flex items-center gap-3 mb-0.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-1.5 rounded-sm" style={{ background: TERRAIN_FILL, opacity: 0.5 }} />
            <span className="text-[9px] font-mono text-text-tertiary">{t("terrain")}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 rounded-sm" style={{ background: MAP_COLORS.accentPrimary }} />
            <span className="text-[9px] font-mono text-text-tertiary">{t("flightPath")}</span>
          </div>
        </div>
      )}

      {/* Chart */}
      {!loading && data.length > 0 && (
        <div className="h-[100px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="terrainGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TERRAIN_FILL} stopOpacity={0.5} />
                  <stop offset="100%" stopColor={TERRAIN_FILL} stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="flightGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={MAP_COLORS.accentPrimary} stopOpacity={0.2} />
                  <stop offset="100%" stopColor={MAP_COLORS.accentPrimary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="distanceLabel"
                tick={{ fill: "var(--alt-text-tertiary)", fontSize: 9, fontFamily: "JetBrains Mono" }}
                axisLine={{ stroke: "var(--alt-border-default)" }}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: "var(--alt-text-tertiary)", fontSize: 9, fontFamily: "JetBrains Mono" }}
                axisLine={false}
                tickLine={false}
                width={35}
                unit="m"
              />
              <Tooltip
                contentStyle={{
                  background: "var(--alt-bg-secondary)",
                  border: "1px solid var(--alt-border-default)",
                  fontSize: "10px",
                  fontFamily: "JetBrains Mono, monospace",
                  color: "var(--alt-text-primary)",
                }}
                formatter={(value: number, name: string) => {
                  const labels: Record<string, string> = {
                    terrainElevation: "Ground",
                    flightAltitude: "Flight",
                    agl: "AGL",
                  };
                  return [`${value}m`, labels[name] || name];
                }}
                labelFormatter={(label) => `${label}m`}
              />
              {/* Terrain area (bottom layer) */}
              <Area
                type="monotone"
                dataKey="terrainElevation"
                stroke={TERRAIN_STROKE}
                strokeWidth={1}
                fill="url(#terrainGrad)"
                activeDot={false}
              />
              {/* Flight altitude line (top layer) */}
              <Area
                type="monotone"
                dataKey="flightAltitude"
                stroke={MAP_COLORS.accentPrimary}
                strokeWidth={1.5}
                fill="url(#flightGrad)"
                activeDot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Empty state */}
      {!loading && data.length === 0 && terrainProfile === null && (
        <div className="flex items-center justify-center h-[40px]">
          <span className="text-[10px] text-text-tertiary font-mono">
            {t("addWaypointsForTerrain")}
          </span>
        </div>
      )}
    </div>
  );
}
