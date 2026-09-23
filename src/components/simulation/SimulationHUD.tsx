/**
 * @module SimulationHUD
 * @description HUD overlay for the trajectory preview. Every value here is computed
 * from the planned path (altitude, commanded speed, geometric heading, distance,
 * ETA) — it is NOT live telemetry. A PREVIEW badge makes that explicit so the
 * operator never reads these as measured flight data.
 * @license GPL-3.0-only
 */

"use client";

import { useMissionStore } from "@/stores/mission-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useInterpolatedPosition } from "@/hooks/use-interpolated-position";
import { useCameraTriggerCount } from "./CameraTriggerEntities";
import { useTranslations } from "next-intl";
import { formatEta } from "@/lib/simulation-utils";
import { formatAlt, formatHeading } from "@/lib/telemetry-utils";
import { Tooltip } from "@/components/ui/tooltip";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { haversineDistance } from "@/lib/geo/distance";

export function SimulationHUD() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const totalDuration = useSimulationStore((s) => s.totalDuration);
  const playbackState = useSimulationStore((s) => s.playbackState);
  const t = useTranslations("simulate");
  const { pos, elapsed } = useInterpolatedPosition();
  const photoCount = useCameraTriggerCount(waypoints);

  if (waypoints.length === 0) return null;

  const remaining = Math.max(0, totalDuration - elapsed);

  // Distance to next waypoint
  const isLastWp = pos.currentWaypointIndex >= waypoints.length - 1;
  const nextWpIdx = Math.min(pos.currentWaypointIndex + 1, waypoints.length - 1);
  const nextWp = !isLastWp ? waypoints[nextWpIdx] : null;
  const distToNext = nextWp
    ? haversineDistance(pos.lat, pos.lon, nextWp.lat, nextWp.lon)
    : 0;
  const distLabel = isLastWp
    ? "---"
    : distToNext >= 1000
      ? `${(distToNext / 1000).toFixed(1)} km`
      : `${Math.round(distToNext)} m`;

  // Modeled fields: every value here is derived from the planned geometry.
  // SPD is the commanded path speed — consistent with the 3D-distance leg
  // timing the preview uses (both 3D), not a separately-modeled ground speed.
  const items = [
    { label: "WP", value: `${pos.currentWaypointIndex + 1}/${waypoints.length}` },
    { label: "ALT", value: formatAlt(pos.alt) },
    { label: "SPD", value: `${pos.speed.toFixed(1)} m/s` },
    { label: "HDG", value: formatHeading(pos.heading) },
    { label: "DIST", value: distLabel },
    { label: "ETA", value: formatEta(remaining) },
    ...(photoCount > 0 ? [{ label: "CAM", value: t("photosCount", { count: photoCount }) }] : []),
  ];

  // Fields the trajectory preview does NOT model. Shown as em-dash so the
  // operator can never read a fabricated number as measured flight data.
  const unmodeled = [
    { label: "BATT" },
    { label: "SIG" },
    { label: "WIND" },
  ];

  // Show HOLD indicator when speed is 0 and playing
  const isHolding = pos.speed === 0 && playbackState === "playing" && elapsed > 0 && elapsed < totalDuration;

  return (
    <div className="absolute top-4 right-4 min-w-[140px]" style={{ zIndex: MAP_OVERLAY_Z.overlay }}>
      <div className="bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg p-3 shadow-lg">
        <div className="flex justify-end pb-1 mb-1 border-b border-border-default">
          <Tooltip content={t("previewSource")} position="left">
            <span className="text-[8px] font-mono tracking-wider text-accent-primary/80">PREVIEW</span>
          </Tooltip>
        </div>
        {items.map((item) => (
          <div key={item.label} className="flex justify-between items-center gap-4 py-0.5">
            <span className="text-[10px] font-mono text-text-tertiary">{item.label}</span>
            <span className="text-xs font-mono text-text-primary">{item.value}</span>
          </div>
        ))}
        {/* Not modeled by the preview — rendered as em-dash, never fabricated */}
        <div className="mt-1 pt-1 border-t border-border-default">
          {unmodeled.map((item) => (
            <div key={item.label} className="flex justify-between items-center gap-4 py-0.5">
              <span className="text-[10px] font-mono text-text-tertiary/60">{item.label}</span>
              <Tooltip content={t("notModeled")} position="left">
                <span className="text-xs font-mono text-text-tertiary/60">&mdash;</span>
              </Tooltip>
            </div>
          ))}
        </div>
        {isHolding && (
          <div className="mt-1 pt-1 border-t border-border-default text-center">
            <span className="text-[10px] font-mono text-status-warning animate-pulse">HOLD</span>
          </div>
        )}
      </div>
      {/* Compass indicator */}
      <div className="mt-2 flex justify-center">
        <div className="w-8 h-8 rounded-full border border-border-default bg-bg-primary/50 flex items-center justify-center relative">
          <svg width="20" height="20" viewBox="0 0 20 20" style={{ transform: `rotate(${pos.heading}deg)` }}>
            <polygon points="10,2 13,10 10,8 7,10" fill="#dff140" opacity="0.9" />
            <polygon points="10,18 13,10 10,12 7,10" fill="#666" opacity="0.5" />
          </svg>
          <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[7px] font-mono text-text-tertiary">N</span>
        </div>
      </div>
    </div>
  );
}
