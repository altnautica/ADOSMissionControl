/**
 * @module TerrainProfileChart
 * @description Terrain elevation profile chart overlaid with flight altitude.
 * Ground elevation renders in an earth tone and the flight path in the accent
 * colour. Altitudes are plotted in MSL so the real clearance above terrain is
 * honest: each waypoint is converted to MSL from its own altitude frame
 * (falling back to the mission default frame when the waypoint carries none),
 * so the Defaults frame selector actually changes the chart. When elevation
 * data is unavailable (offline / every lookup failed) the chart says so instead
 * of drawing a flat sea-level profile.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { Mountain, Loader2, RefreshCw } from "lucide-react";
import type { Waypoint, AltitudeFrame } from "@/lib/types";
import { haversineDistance } from "@/lib/telemetry-utils";
import { useTerrainProfile } from "@/hooks/use-terrain-profile";
import { usePlannerStore } from "@/stores/planner-store";
import { MAP_COLORS } from "@/lib/map-constants";
import { findCollisionSegments, DEFAULT_MIN_TERRAIN_CLEARANCE } from "@/lib/terrain/terrain-clearance";
import { waypointAbsoluteAltitude } from "@/lib/mission/altitude-frame";

/** Terrain profile chart colors. */
const TERRAIN_FILL = "#8B6914";
const TERRAIN_STROKE = "#6B5010";
const DANGER_COLOR = "#ef4444";

/** Merged data point for the combined chart. All altitudes are MSL. */
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
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  // Single shared producer — the chart, the along-leg validator, and the
  // red-collision renderers all read the same profile.
  const { profile: terrainProfile, status } = useTerrainProfile(waypoints);
  // The chart follows the mission's altitude frame by default; the cycle button
  // is an optional override for previewing the path in another frame. When the
  // Defaults frame selector changes the mission frame, the view snaps back to it.
  const [displayFrame, setDisplayFrame] = useState<AltitudeFrame>(defaultFrame);

  useEffect(() => {
    setDisplayFrame(defaultFrame);
  }, [defaultFrame]);

  // Build chart data in MSL. Each waypoint is converted to an MSL altitude from
  // its own frame (or the display frame when the waypoint carries none), then
  // the flight line is interpolated between waypoints along the terrain samples.
  const data: ChartDataPoint[] = useMemo(() => {
    if (!terrainProfile || terrainProfile.points.length === 0 || waypoints.length < 2) {
      return [];
    }

    const profilePoints = terrainProfile.points;

    // Cumulative distance at each waypoint.
    let totalDist = 0;
    const wpDistances: number[] = [0];
    for (let i = 1; i < waypoints.length; i++) {
      totalDist += haversineDistance(
        waypoints[i - 1].lat, waypoints[i - 1].lon,
        waypoints[i].lat, waypoints[i].lon,
      );
      wpDistances.push(totalDist);
    }

    // Terrain elevation (MSL) at an arbitrary distance along the path.
    const terrainElevAt = (dist: number): number => {
      const first = profilePoints[0];
      const last = profilePoints[profilePoints.length - 1];
      if (dist <= first.distance) return first.elevation;
      if (dist >= last.distance) return last.elevation;
      for (let i = 1; i < profilePoints.length; i++) {
        const b = profilePoints[i];
        if (dist <= b.distance) {
          const a = profilePoints[i - 1];
          const span = b.distance - a.distance;
          const f = span > 0 ? (dist - a.distance) / span : 0;
          return a.elevation + (b.elevation - a.elevation) * f;
        }
      }
      return last.elevation;
    };

    // Ground at the takeoff point is the datum for relative-frame altitudes.
    const homeGround = profilePoints[0].elevation;

    // MSL flight altitude at each waypoint, resolved through the shared
    // frame model so the chart, the validator and the 3D view cannot disagree
    // about what a `relative` altitude means. A waypoint with no elevation
    // sample of its own borrows the interpolated terrain at its distance.
    const wpMsl = waypoints.map(
      (wp, i) =>
        waypointAbsoluteAltitude(
          wp,
          { homeGroundElevation: homeGround, defaultFrame: displayFrame },
          wp.groundElevation ?? terrainElevAt(wpDistances[i]),
        ) ?? homeGround + wp.alt,
    );

    return profilePoints.map((tp) => {
      // Interpolate the flight MSL for this terrain sample's distance.
      let flightMsl = wpMsl[0];
      for (let i = 1; i < wpDistances.length; i++) {
        if (tp.distance <= wpDistances[i]) {
          const segStart = wpDistances[i - 1];
          const segEnd = wpDistances[i];
          const segLen = segEnd - segStart;
          const f = segLen > 0 ? (tp.distance - segStart) / segLen : 0;
          flightMsl = wpMsl[i - 1] + (wpMsl[i] - wpMsl[i - 1]) * f;
          break;
        }
        flightMsl = wpMsl[wpMsl.length - 1];
      }

      const agl = flightMsl - tp.elevation;
      return {
        distance: Math.round(tp.distance),
        distanceLabel: tp.distance >= 1000
          ? `${(tp.distance / 1000).toFixed(1)}`
          : `${Math.round(tp.distance)}`,
        terrainElevation: Math.round(tp.elevation),
        flightAltitude: Math.round(flightMsl),
        agl: Math.round(agl),
        // Terrain painted red only where the flight path drops below the minimum
        // clearance (a leg clipping a ridge between two clear waypoints). null
        // elsewhere so recharts leaves gaps and only the danger stretch is red.
        dangerTerrain: agl < DEFAULT_MIN_TERRAIN_CLEARANCE ? Math.round(tp.elevation) : null,
      };
    });
  }, [terrainProfile, waypoints, displayFrame]);

  // Contiguous stretches where the flight path breaches the clearance minimum.
  const collisionSegments = useMemo(
    () => findCollisionSegments(data.map((d) => ({ distance: d.distance, agl: d.agl }))),
    [data],
  );

  const frameLabel = useCallback((f: AltitudeFrame): string => {
    if (f === "terrain") return t("terrainFollowingAgl");
    if (f === "absolute") return t("frameAbsolute");
    return t("relativeToTakeoff");
  }, [t]);

  const cycleFrame = useCallback(() => {
    setDisplayFrame((f) => (f === "relative" ? "absolute" : f === "absolute" ? "terrain" : "relative"));
  }, []);

  if (waypoints.length < 2) return null;

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      {/* Frame selector — defaults to the mission's altitude frame */}
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Mountain size={12} className="text-text-tertiary" />
          <span className="text-[10px] font-mono text-text-tertiary">
            {frameLabel(displayFrame)}
          </span>
        </div>
        <button
          onClick={cycleFrame}
          className="flex items-center gap-1 text-[10px] font-mono text-accent-primary hover:text-accent-primary/80 cursor-pointer"
          title={t("cycleFrame")}
        >
          <RefreshCw size={10} />
          {t("cycleFrame")}
        </button>
      </div>

      {/* Loading state */}
      {status === "loading" && (
        <div className="flex items-center justify-center h-[80px]">
          <Loader2 size={14} className="text-text-tertiary animate-spin" />
          <span className="text-[10px] text-text-tertiary ml-2">{t("loadingTerrain")}</span>
        </div>
      )}

      {/* Unavailable (offline) state — distinct from the empty mission, which
          renders no chart at all (fewer than two waypoints). */}
      {status === "unavailable" && (
        <div className="flex items-center justify-center h-[80px]">
          <span className="text-[10px] text-text-tertiary font-mono text-center px-2">
            {t("unavailableOffline")}
          </span>
        </div>
      )}

      {/* Legend */}
      {status === "ready" && data.length > 0 && (
        <div className="flex items-center gap-3 mb-0.5">
          <div className="flex items-center gap-1">
            <div className="w-3 h-1.5 rounded-sm" style={{ background: TERRAIN_FILL, opacity: 0.5 }} />
            <span className="text-[9px] font-mono text-text-tertiary">{t("terrain")}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-0.5 rounded-sm" style={{ background: MAP_COLORS.accentPrimary }} />
            <span className="text-[9px] font-mono text-text-tertiary">{t("flightPath")}</span>
          </div>
          {collisionSegments.length > 0 && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-1.5 rounded-sm" style={{ background: DANGER_COLOR, opacity: 0.6 }} />
              <span className="text-[9px] font-mono" style={{ color: DANGER_COLOR }}>
                {t("terrainConflict", { count: collisionSegments.length })}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {status === "ready" && data.length > 0 && (
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
              {/* Danger terrain — painted red only where the flight path drops
                  below the clearance minimum (gaps elsewhere). */}
              <Area
                type="monotone"
                dataKey="dangerTerrain"
                stroke={DANGER_COLOR}
                strokeWidth={1.5}
                fill={DANGER_COLOR}
                fillOpacity={0.35}
                connectNulls={false}
                activeDot={false}
                isAnimationActive={false}
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
    </div>
  );
}
