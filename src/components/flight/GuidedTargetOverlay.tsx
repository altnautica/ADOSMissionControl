/**
 * @module GuidedTargetOverlay
 * @description Map overlay for the selected drone's active guided target:
 * a Fly Here in progress, or a Land Here repositioning before it descends.
 * Cancel commands the vehicle to hold (through the skill dispatcher, so a
 * refusal is reported) and ends the target; arrival and mode changes are
 * handled by the target's supervisor.
 * @license GPL-3.0-only
 */
"use client";

import { useGuidedStore } from "@/stores/guided-store";
import { useTelemetryStore } from "@/stores/telemetry-store";
import { useDroneManager } from "@/stores/drone-manager";
import { haversineDistance } from "@/lib/telemetry-utils";
import { activate, buildSkillContext } from "@/lib/skills";
import { cancelGuidedTarget } from "@/lib/skills/guided-target";
import { X, Navigation } from "lucide-react";

export function GuidedTargetOverlay() {
  const target = useGuidedStore((s) => s.target);
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const posBuffer = useTelemetryStore((s) => s.position);
  const latestPos = posBuffer.latest();

  if (!target || target.droneId !== selectedDroneId) return null;

  // The cancel control stays reachable even with no position fix.
  const distance = latestPos
    ? haversineDistance(latestPos.lat, latestPos.lon, target.lat, target.lon)
    : null;
  const title =
    target.purpose === "land"
      ? "Repositioning to land point"
      : target.purpose === "loiter"
        ? "Repositioning to loiter point"
        : "Flying to target";
  const cancelLabel =
    target.purpose === "land"
      ? "Cancel land here and hold position"
      : target.purpose === "loiter"
        ? "Cancel loiter here and hold position"
        : "Cancel guided target and hold position";

  const cancel = () => {
    const { droneId } = target;
    cancelGuidedTarget();
    // Clearing the overlay alone left the vehicle flying on to the target.
    // Pause holds it where it is (LOITER on ArduPilot, Hold on PX4).
    void activate("pause", buildSkillContext(droneId));
  };

  return (
    <div className="absolute top-3 right-3 z-[1100]">
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-secondary/95 backdrop-blur-sm border border-accent-primary/30 rounded-lg">
        <Navigation size={12} className="text-accent-primary shrink-0" />
        <div className="flex flex-col">
          <span className="text-[10px] text-accent-primary font-semibold">
            {title}
          </span>
          <span className="text-[10px] text-text-secondary font-mono">
            {distance === null
              ? "-- remaining"
              : `${distance < 1000 ? `${Math.round(distance)} m` : `${(distance / 1000).toFixed(2)} km`} remaining`}
          </span>
        </div>
        <button
          onClick={cancel}
          className="ml-2 p-1 text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
          title={cancelLabel}
          aria-label={cancelLabel}
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
