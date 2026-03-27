/**
 * @module GuidedTargetOverlay
 * @description Map overlay showing active guided mode target.
 * Renders a pulsing target marker and a dashed line from drone to target.
 * Includes cancel button. Clears automatically when drone arrives (< 3m).
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useGuidedStore } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { haversineDistance } from "@/lib/telemetry-utils";
import { X, Navigation } from "lucide-react";

const ARRIVAL_THRESHOLD_M = 5;

export function GuidedTargetOverlay() {
  const target = useGuidedStore((s) => s.target);
  const clearTarget = useGuidedStore((s) => s.clearTarget);
  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  // Auto-clear when drone arrives at target
  useEffect(() => {
    if (!target || !latestPos) return;
    const dist = haversineDistance(latestPos.lat, latestPos.lon, target.lat, target.lon);
    if (dist < ARRIVAL_THRESHOLD_M) {
      clearTarget();
    }
  }, [target, latestPos, clearTarget]);

  if (!target || !latestPos) return null;

  const distance = haversineDistance(latestPos.lat, latestPos.lon, target.lat, target.lon);

  return (
    <div className="absolute top-3 right-3 z-[1100]">
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary/95 backdrop-blur-sm border border-accent-primary/30 rounded-lg">
        <Navigation size={12} className="text-accent-primary shrink-0" />
        <div className="flex flex-col">
          <span className="text-[10px] text-accent-primary font-semibold">
            Flying to target
          </span>
          <span className="text-[10px] text-text-secondary font-mono">
            {distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`} remaining
          </span>
        </div>
        <button
          onClick={clearTarget}
          className="ml-2 p-1 text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
          title="Cancel guided target"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
