/**
 * @module FollowMeButton
 * @description Toggle button for follow-me mode in the flight actions panel.
 * Starts a session on the selected drone. While a session runs, the button is
 * its stop control and names the drone being commanded, and shows the GPS
 * accuracy of the GCS fix.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback, useState } from "react";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFollowMeStore } from "@/stores/follow-me-store";
import { useDroneManager } from "@/stores/drone-manager";
import { startFollowMe, stopFollowMe } from "@/lib/follow-me";
import { cn } from "@/lib/utils";

export function FollowMeButton() {
  const isActive = useFollowMeStore((s) => s.isActive);
  const isPaused = useFollowMeStore((s) => s.isPaused);
  const gcsAccuracy = useFollowMeStore((s) => s.gcsAccuracy);
  const droneName = useFollowMeStore((s) => s.droneName);
  const selectedId = useDroneManager((s) => s.selectedDroneId);
  const [starting, setStarting] = useState(false);

  const handleToggle = useCallback(async () => {
    if (isActive) {
      stopFollowMe();
      return;
    }
    if (!selectedId) return;

    setStarting(true);
    try {
      await startFollowMe(selectedId);
    } catch {
      // Geolocation error
    } finally {
      setStarting(false);
    }
  }, [isActive, selectedId]);

  // Accuracy color
  const accColor = gcsAccuracy < 15
    ? "bg-status-success"
    : gcsAccuracy < 50
    ? "bg-status-warning"
    : "bg-status-error";

  const label = starting
    ? "Starting..."
    : isActive
    ? `${isPaused ? "GPS weak" : "Following"}: ${droneName ?? "drone"} (stop)`
    : "Follow Me";

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant={isActive ? "primary" : "secondary"}
        size="sm"
        icon={<MapPin size={12} />}
        onClick={handleToggle}
        disabled={starting}
        title={isActive ? `Stop follow-me on ${droneName ?? "drone"}` : undefined}
        className={cn(
          "flex-1",
          isActive && "ring-1 ring-accent-primary",
          isPaused && "animate-pulse",
        )}
      >
        {label}
      </Button>
      {isActive && (
        <div className="flex items-center gap-1 px-1.5 py-1 bg-bg-tertiary rounded text-[9px] font-mono text-text-secondary">
          <div className={cn("w-1.5 h-1.5 rounded-full", accColor)} />
          {Math.round(gcsAccuracy)}m
        </div>
      )}
    </div>
  );
}
