"use client";

/**
 * @module QuickShotLauncher
 * @description Grid of QuickShot types with selection and launch button.
 * @license GPL-3.0-only
 */

import {
  MoveUpRight,
  ArrowUp,
  RotateCw,
  Orbit,
  Undo2,
  Rocket,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import type { LucideIcon } from "lucide-react";

interface QuickShotDef {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
}

const QUICKSHOTS: QuickShotDef[] = [
  {
    id: "quickshot-dronie",
    name: "Dronie",
    description: "Fly backward and up for a reveal shot",
    icon: MoveUpRight,
  },
  {
    id: "quickshot-rocket",
    name: "Rocket",
    description: "Straight up, camera looking down",
    icon: ArrowUp,
  },
  {
    id: "quickshot-circle",
    name: "Circle",
    description: "Full 360 orbit around subject",
    icon: RotateCw,
  },
  {
    id: "quickshot-helix",
    name: "Helix",
    description: "Spiral upward while orbiting",
    icon: Orbit,
  },
  {
    id: "quickshot-boomerang",
    name: "Boomerang",
    description: "Arc away and return smoothly",
    icon: Undo2,
  },
];

export function QuickShotLauncher() {
  const selectedQuickShot = useSmartModeStore((s) => s.selectedQuickShot);
  const setSelectedQuickShot = useSmartModeStore((s) => s.setSelectedQuickShot);
  const setActiveBehavior = useSmartModeStore((s) => s.setActiveBehavior);
  const setBehaviorState = useSmartModeStore((s) => s.setBehaviorState);

  const handleLaunch = () => {
    if (!selectedQuickShot) return;
    setActiveBehavior(selectedQuickShot);
    setBehaviorState("executing");
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-semibold text-text-primary">QuickShots</h3>

      <div className="grid grid-cols-2 gap-2">
        {QUICKSHOTS.map((shot) => {
          const Icon = shot.icon;
          const isSelected = selectedQuickShot === shot.id;
          return (
            <button
              key={shot.id}
              onClick={() => setSelectedQuickShot(isSelected ? null : shot.id)}
              className={cn(
                "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-colors text-center",
                isSelected
                  ? "border-accent-primary bg-accent-primary/10"
                  : "border-border-default bg-bg-secondary hover:border-border-hover"
              )}
            >
              <Icon className={cn(
                "w-5 h-5",
                isSelected ? "text-accent-primary" : "text-text-secondary"
              )} />
              <span className={cn(
                "text-xs font-medium",
                isSelected ? "text-accent-primary" : "text-text-primary"
              )}>
                {shot.name}
              </span>
              <span className="text-[10px] text-text-tertiary leading-tight">
                {shot.description}
              </span>
            </button>
          );
        })}
      </div>

      <button
        onClick={handleLaunch}
        disabled={!selectedQuickShot}
        className={cn(
          "flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
          selectedQuickShot
            ? "bg-accent-primary text-white hover:bg-accent-primary/90"
            : "bg-bg-secondary text-text-tertiary border border-border-default cursor-not-allowed"
        )}
      >
        <Rocket className="w-4 h-4" />
        Launch
      </button>
    </div>
  );
}
