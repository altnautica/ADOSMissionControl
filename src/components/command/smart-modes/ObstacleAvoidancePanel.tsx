"use client";

/**
 * @module ObstacleAvoidancePanel
 * @description Controls for obstacle avoidance: mode toggle, min distance, sensitivity, status display.
 * @license GPL-3.0-only
 */

import { ShieldAlert, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { Select } from "@/components/ui/select";

const THREAT_COLORS: Record<string, string> = {
  green: "text-status-success",
  yellow: "text-status-warning",
  red: "text-status-error",
};

const THREAT_LABELS: Record<string, string> = {
  green: "Clear",
  yellow: "Caution",
  red: "Danger",
};

export function ObstacleAvoidancePanel() {
  const params = useSmartModeStore((s) => s.behaviorParams);
  const updateParam = useSmartModeStore((s) => s.updateParam);
  const nearestObstacle = useAgentCapabilitiesStore((s) => s.vision.nearest_obstacle_m);
  const threatLevel = useAgentCapabilitiesStore((s) => s.vision.threat_level);

  const mode = (params.mode as string) ?? "brake";
  const minDistance = (params.min_distance as number) ?? 3;
  const sensitivity = (params.sensitivity as string) ?? "normal";

  const threatColor = THREAT_COLORS[threatLevel] ?? "text-text-tertiary";
  const threatLabel = THREAT_LABELS[threatLevel] ?? "Unknown";

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <ShieldAlert className="w-4 h-4 text-text-secondary" />
        <h3 className="text-sm font-semibold text-text-primary">Obstacle Avoidance</h3>
      </div>

      {/* Status display */}
      <div className="flex items-center justify-between p-3 rounded-lg bg-bg-secondary border border-border-default">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-text-tertiary">Nearest Obstacle</span>
          <span className="text-lg font-mono text-text-primary">
            {nearestObstacle !== null ? `${nearestObstacle.toFixed(1)} m` : "--"}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <Circle className={cn("w-3 h-3 fill-current", threatColor)} />
          <span className={cn("text-sm font-medium", threatColor)}>
            {threatLabel}
          </span>
        </div>
      </div>

      {/* Mode */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-secondary">Avoidance Mode</label>
        <div className="flex gap-1">
          {(["off", "brake", "detour"] as const).map((m) => (
            <button
              key={m}
              onClick={() => updateParam("mode", m)}
              className={cn(
                "flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors capitalize",
                mode === m
                  ? "bg-accent-primary text-white"
                  : "bg-bg-secondary text-text-secondary border border-border-default hover:border-border-hover"
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Min Distance */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Minimum Distance</label>
          <span className="text-xs font-mono text-text-tertiary">{minDistance} m</span>
        </div>
        <input
          type="range"
          min={1}
          max={10}
          step={0.5}
          value={minDistance}
          onChange={(e) => updateParam("min_distance", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* Sensitivity */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-secondary">Sensitivity</label>
        <Select
          value={sensitivity}
          onChange={(val) => updateParam("sensitivity", val)}
          options={[
            { value: "low", label: "Low (fewer false positives)" },
            { value: "normal", label: "Normal" },
            { value: "high", label: "High (more cautious)" },
          ]}
        />
      </div>
    </div>
  );
}
