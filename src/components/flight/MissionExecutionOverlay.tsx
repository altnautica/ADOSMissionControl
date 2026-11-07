"use client";

/**
 * @module MissionExecutionOverlay
 * @description Shows mission execution telemetry: ETA to next waypoint and
 * cross-track error (XTE). Reads VFR_HUD (groundspeed) and
 * NAV_CONTROLLER_OUTPUT (wp distance, xtrack error) only while each is fresh,
 * and keys visibility on the heartbeat-backed flight mode, so a lost link
 * blanks the readings instead of freezing them.
 * Only visible when a mission is active.
 * @license GPL-3.0-only
 */

import { useFreshTelemetry } from "@/hooks/use-telemetry-latest";
import { useMissionStore } from "@/stores/mission-store";
import { useLiveFlightMode } from "@/hooks/use-live-flight-mode";
import { useMissionStatus } from "@/lib/mission/use-mission-status";
import { useDroneManager } from "@/stores/drone-manager";
import { Navigation, Crosshair } from "lucide-react";

export function MissionExecutionOverlay() {
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  // C8 mission state: shown while the mission flies or is paused, never
  // inferred from flight-mode names.
  const mission = useMissionStatus(selectedId);
  const currentWaypoint = useMissionStore((s) => s.currentWaypoint);
  const waypointCount = useMissionStore((s) => s.waypoints.length);
  const nav = useFreshTelemetry("navController");
  const vfr = useFreshTelemetry("vfr");

  // The heartbeat gate the HUD applies: a mission state the link stopped
  // confirming is not shown as live.
  const linkLive = useLiveFlightMode() !== null;
  const showOverlay = linkLive && (mission?.state === "active" || mission?.state === "paused");

  const wpDist = nav?.wpDist ?? null;
  const xte = nav?.xtrackError ?? null;
  const groundspeed = vfr?.groundspeed;
  const eta =
    wpDist !== null && groundspeed !== undefined && groundspeed > 0.5 && wpDist > 0
      ? wpDist / groundspeed
      : null;

  if (!showOverlay) return null;

  const etaStr = eta !== null
    ? eta >= 60
      ? `${Math.floor(eta / 60)}m ${Math.floor(eta % 60)}s`
      : `${Math.floor(eta)}s`
    : "--";

  const xteStr = xte !== null ? `${Math.abs(xte).toFixed(1)}m` : "--";
  const distStr = wpDist !== null
    ? wpDist >= 1000
      ? `${(wpDist / 1000).toFixed(2)}km`
      : `${Math.round(wpDist)}m`
    : "--";

  // Color XTE based on deviation magnitude
  const xteColor = xte !== null
    ? Math.abs(xte) > 10
      ? "text-status-error"
      : Math.abs(xte) > 5
        ? "text-status-warning"
        : "text-status-success"
    : "text-text-tertiary";

  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 z-[1000] flex items-center gap-3 px-3 py-1.5 bg-bg-secondary/90 border border-border-default backdrop-blur-sm">
      {/* Waypoint progress: 1-based for the operator; "--" when the FC's
          current item cannot be mapped onto this plan (no matching upload). */}
      <span className="text-[9px] font-mono text-text-tertiary">
        WP {currentWaypoint === null ? "--" : currentWaypoint + 1}/{waypointCount}
      </span>

      <div className="w-px h-3 bg-border-default" />

      {/* Distance to next WP */}
      <div className="flex items-center gap-1">
        <Navigation size={9} className="text-accent-primary" />
        <span className="text-[9px] font-mono text-text-secondary">
          {distStr}
        </span>
      </div>

      <div className="w-px h-3 bg-border-default" />

      {/* ETA */}
      <div className="flex items-center gap-1">
        <span className="text-[9px] font-mono text-text-tertiary">ETA</span>
        <span className="text-[9px] font-mono text-text-primary font-semibold">
          {etaStr}
        </span>
      </div>

      <div className="w-px h-3 bg-border-default" />

      {/* Cross-track error */}
      <div className="flex items-center gap-1">
        <Crosshair size={9} className={xteColor} />
        <span className="text-[9px] font-mono text-text-tertiary">XTE</span>
        <span className={`text-[9px] font-mono font-semibold ${xteColor}`}>
          {xteStr}
        </span>
      </div>
    </div>
  );
}
