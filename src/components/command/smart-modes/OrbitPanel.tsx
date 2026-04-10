"use client";

/**
 * @module OrbitPanel
 * @description Controls for Orbit smart mode: radius, speed, altitude, direction.
 * @license GPL-3.0-only
 */

import { useSmartModeStore } from "@/stores/smart-mode-store";
import { Select } from "@/components/ui/select";

export function OrbitPanel() {
  const params = useSmartModeStore((s) => s.behaviorParams);
  const updateParam = useSmartModeStore((s) => s.updateParam);

  const radius = (params.radius as number) ?? 15;
  const speed = (params.speed as number) ?? 3;
  const altitude = (params.altitude as number) ?? 20;
  const direction = (params.direction as string) ?? "cw";

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-text-primary">Orbit Settings</h3>

      {/* Radius */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Radius</label>
          <span className="text-xs font-mono text-text-tertiary">{radius} m</span>
        </div>
        <input
          type="range"
          min={5}
          max={100}
          step={1}
          value={radius}
          onChange={(e) => updateParam("radius", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* Speed */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-text-secondary">Speed</label>
          <span className="text-xs font-mono text-text-tertiary">{speed} m/s</span>
        </div>
        <input
          type="range"
          min={0.5}
          max={8}
          step={0.5}
          value={speed}
          onChange={(e) => updateParam("speed", Number(e.target.value))}
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
          max={100}
          step={1}
          value={altitude}
          onChange={(e) => updateParam("altitude", Number(e.target.value))}
          className="w-full accent-accent-primary"
        />
      </div>

      {/* Direction */}
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-secondary">Direction</label>
        <Select
          value={direction}
          onChange={(val) => updateParam("direction", val)}
          options={[
            { value: "cw", label: "Clockwise" },
            { value: "ccw", label: "Counter-clockwise" },
          ]}
        />
      </div>
    </div>
  );
}
