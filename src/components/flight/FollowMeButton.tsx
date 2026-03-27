/**
 * @module FollowMeButton
 * @description Toggle button for follow-me mode in the flight actions panel.
 * Shows GPS accuracy indicator when active.
 * @license GPL-3.0-only
 */
"use client";

import { useCallback } from "react";
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
  const getProtocol = useDroneManager((s) => s.getSelectedProtocol);

  const handleToggle = useCallback(async () => {
    if (isActive) {
      stopFollowMe();
      return;
    }

    const protocol = getProtocol();
    if (!protocol?.isConnected) return;

    await startFollowMe(protocol);
  }, [isActive, getProtocol]);

  // Accuracy color
  const accColor = gcsAccuracy < 15
    ? "bg-status-success"
    : gcsAccuracy < 50
    ? "bg-status-warning"
    : "bg-status-error";

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant={isActive ? "primary" : "secondary"}
        size="sm"
        icon={<MapPin size={12} />}
        onClick={handleToggle}
        className={cn(
          "flex-1",
          isActive && "ring-1 ring-accent-primary",
          isPaused && "animate-pulse",
        )}
      >
        {isActive ? (isPaused ? "GPS Lost" : "Following") : "Follow Me"}
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
