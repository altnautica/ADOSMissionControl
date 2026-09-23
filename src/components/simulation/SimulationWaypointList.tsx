/**
 * @module SimulationWaypointList
 * @description Active waypoint card and waypoint progress list with ETAs.
 * Pure presentational; receives interpolated position state and seek callback
 * from the parent.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import type { Waypoint } from "@/lib/types";
import type { InterpolatedPosition } from "@/lib/simulation-utils";
import { formatEta } from "@/lib/simulation-utils";
import { formatAlt } from "@/lib/telemetry-utils";
import { cn } from "@/lib/utils";

interface SimulationWaypointListProps {
  waypoints: Waypoint[];
  pos: InterpolatedPosition;
  elapsed: number;
  cumulativeTimes: number[];
  playbackState: string;
  onSeekToWaypoint: (wpIndex: number) => void;
}

export function SimulationWaypointList({
  waypoints,
  pos,
  elapsed,
  cumulativeTimes,
  playbackState,
  onSeekToWaypoint,
}: SimulationWaypointListProps) {
  const t = useTranslations("simulate");
  const currentWp = waypoints.length >= 2 ? waypoints[pos.currentWaypointIndex] : null;

  return (
    <>
      {/* Active waypoint card */}
      {currentWp && (
        <div className="px-3 py-2 border-b border-border-default">
          <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-1.5">
            {t("activeWaypoint")}
          </h3>
          <div className="bg-accent-primary/10 border border-accent-primary/30 rounded p-2">
            <div className="flex items-center gap-1.5 mb-1.5">
              <MapPin size={10} className="text-accent-primary" />
              <span className="text-xs font-mono font-semibold text-text-primary">
                WP {pos.currentWaypointIndex + 1} / {waypoints.length}
              </span>
              <span className="text-[9px] font-mono text-accent-primary ml-auto uppercase">
                {playbackState === "playing" ? t("active") : playbackState}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-1">
              <div>
                <span className="text-[9px] text-text-tertiary">{t("alt")}</span>
                <p className="text-[10px] font-mono text-text-primary">{formatAlt(currentWp.alt)}</p>
              </div>
              <div>
                <span className="text-[9px] text-text-tertiary">{t("elapsed")}</span>
                <p className="text-[10px] font-mono text-text-primary">{formatEta(elapsed)}</p>
              </div>
              <div>
                <span className="text-[9px] text-text-tertiary">{t("speedLabel")}</span>
                <p className="text-[10px] font-mono text-text-primary">{pos.speed.toFixed(1)} m/s</p>
              </div>
              <div>
                <span className="text-[9px] text-text-tertiary">{t("headingLabel")}</span>
                <p className="text-[10px] font-mono text-text-primary">{Math.round(pos.heading)}&deg;</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Waypoint progress list with ETAs */}
      <div className="px-3 py-2 border-b border-border-default">
        <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">
          {t("waypointProgress")}
        </h3>
        <div className="space-y-1">
          {waypoints.map((wp, i) => {
            const isCurrent = i === pos.currentWaypointIndex;
            const isCompleted = i < pos.currentWaypointIndex;
            const isUpcoming = i > pos.currentWaypointIndex;

            // Calculate ETA for upcoming waypoints
            let eta: number | null = null;
            if (isUpcoming && cumulativeTimes.length > 0) {
              const segIdx = Math.min(i - 1, cumulativeTimes.length - 1);
              if (segIdx >= 0) {
                eta = Math.max(0, cumulativeTimes[segIdx] - elapsed);
              }
            }

            return (
              <button
                key={wp.id}
                onClick={() => onSeekToWaypoint(i)}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-left transition-colors cursor-pointer",
                  isCurrent && "bg-accent-primary/10 border border-accent-primary/30",
                  isCompleted && "opacity-50",
                  isUpcoming && "hover:bg-bg-tertiary"
                )}
              >
                <MapPin
                  size={12}
                  className={cn(
                    isCurrent
                      ? "text-accent-primary"
                      : isCompleted
                        ? "text-status-success"
                        : "text-text-tertiary"
                  )}
                />
                <span className="text-xs font-mono text-text-primary flex-1">
                  WP {i + 1}
                </span>
                <span className="text-[10px] font-mono text-text-tertiary">
                  {formatAlt(wp.alt)}
                </span>
                {eta !== null && (
                  <span className="text-[10px] font-mono text-text-tertiary">
                    ETA {formatEta(eta)}
                  </span>
                )}
                {isCompleted && (
                  <span className="text-[9px] font-mono text-status-success">&check;</span>
                )}
                {isCurrent && (
                  <span className="text-[9px] font-mono text-accent-primary">&bull;</span>
                )}
                {(wp.holdTime ?? 0) > 0 && (
                  <span className="text-[9px] font-mono text-status-warning px-1 py-0.5 bg-status-warning/10 rounded">
                    {wp.holdTime}s
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
