"use client";

/**
 * @module FollowMePanel
 * @description Controls for Follow Me smart mode: distance, altitude, speed, loss action, obstacle mode.
 * @license GPL-3.0-only
 */

import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import { Select } from "@/components/ui/select";

export function FollowMePanel() {
  const params = useSmartModeStore((s) => s.behaviorParams);
  const updateParam = useSmartModeStore((s) => s.updateParam);

  const followDistance = (params.follow_distance as number) ?? 10;
  const altitude = (params.follow_altitude as number) ?? 15;
  const maxSpeed = (params.max_speed as number) ?? 8;
  const lossAction = (params.loss_action as string) ?? "hover";
  const obstacleMode = (params.obstacle_mode as string) ?? "brake";

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-text-primary">Follow Me Settings</h3>

      {/* Follow Distance */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Follow Distance</label>
          <span className="text-xs font-mono text-text-tertiary">{followDistance} m</span>
        </div>
        <input
          type="range"
          min={3}
          max={30}
          step={1}
          value={followDistance}
          onChange={(e) => updateParam("follow_distance", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* Altitude */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Altitude</label>
          <span className="text-xs font-mono text-text-tertiary">{altitude} m</span>
        </div>
        <input
          type="range"
          min={5}
          max={50}
          step={1}
          value={altitude}
          onChange={(e) => updateParam("follow_altitude", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* Max Speed */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Max Speed</label>
          <span className="text-xs font-mono text-text-tertiary">{maxSpeed} m/s</span>
        </div>
        <input
          type="range"
          min={1}
          max={15}
          step={0.5}
          value={maxSpeed}
          onChange={(e) => updateParam("max_speed", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* On Target Lost */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-secondary">On Target Lost</label>
        <Select
          value={lossAction}
          onChange={(val) => updateParam("loss_action", val)}
          options={[
            { value: "hover", label: "Hover and wait" },
            { value: "rtl", label: "Return to launch" },
            { value: "land", label: "Land in place" },
          ]}
        />
      </div>

      {/* Obstacle Avoidance */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-secondary">Obstacle Avoidance</label>
        <Select
          value={obstacleMode}
          onChange={(val) => updateParam("obstacle_mode", val)}
          options={[
            { value: "off", label: "Off" },
            { value: "brake", label: "Brake (stop on obstacle)" },
            { value: "detour", label: "Detour (fly around)" },
          ]}
        />
      </div>
    </div>
  );
}
