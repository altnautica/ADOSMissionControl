/**
 * @module SimulationHUD
 * @description Glassmorphism HUD overlay showing current telemetry during simulation playback.
 * Displays waypoint progress, altitude, speed, heading, and ETA.
 * @license GPL-3.0-only
 */

"use client";

import { useMissionStore } from "@/stores/mission-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useInterpolatedPosition } from "@/hooks/use-interpolated-position";
import { useCameraTriggerCount } from "./CameraTriggerEntities";
import { useTranslations } from "next-intl";
import { formatEta } from "@/lib/simulation-utils";
import { formatAlt, formatHeading, haversineDistance } from "@/lib/telemetry-utils";

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

  const items = [
    { label: "WP", value: `${pos.currentWaypointIndex + 1}/${waypoints.length}` },
    { label: "ALT", value: formatAlt(pos.alt) },
    { label: "SPD", value: `${pos.speed.toFixed(1)} m/s` },
    { label: "HDG", value: formatHeading(pos.heading) },
    { label: "DIST", value: distLabel },
    { label: "ETA", value: formatEta(remaining) },
    ...(photoCount > 0 ? [{ label: "CAM", value: t("photosCount", { count: photoCount }) }] : []),
  ];

  // Show HOLD indicator when speed is 0 and playing
  const isHolding = pos.speed === 0 && playbackState === "playing" && elapsed > 0 && elapsed < totalDuration;

  return (
    <div className="absolute top-4 right-4 z-10 min-w-[140px]">
      <div className="bg-bg-primary/70 backdrop-blur-md border border-border-default rounded-lg p-3 shadow-lg">
        {items.map((item) => (
          <div key={item.label} className="flex justify-between items-center gap-4 py-0.5">
            <span className="text-[10px] font-mono text-text-tertiary">{item.label}</span>
            <span className="text-xs font-mono text-text-primary">{item.value}</span>
          </div>
        ))}
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
