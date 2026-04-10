"use client";

/**
 * @module ModeSelectorBar
 * @description Horizontal row of mode buttons at the bottom of the Smart Modes tab.
 * Each enabled smart mode gets a pill button. Active mode is highlighted.
 * @license GPL-3.0-only
 */

import {
  UserRound,
  Crosshair,
  CircleDot,
  Camera,
  ShieldAlert,
  Target,
  Mountain,
  Hand,
  Maximize2,
  MoveUpRight,
  ArrowUp,
  RotateCw,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import { useAvailableFeatures } from "@/hooks/use-available-features";
import type { LucideIcon } from "lucide-react";

// Map feature IDs to their icons
const ICON_MAP: Record<string, LucideIcon> = {
  "follow-me": UserRound,
  "active-track": Crosshair,
  orbit: CircleDot,
  "quickshot-dronie": MoveUpRight,
  "quickshot-rocket": ArrowUp,
  "quickshot-circle": RotateCw,
  "quickshot-helix": CircleDot,
  "quickshot-boomerang": Undo2,
  "obstacle-avoidance": ShieldAlert,
  "precision-landing": Target,
  "terrain-following": Mountain,
  "gesture-recognition": Hand,
  panorama: Maximize2,
};

/** Modes shown in the selector. QuickShots are grouped under one "QuickShots" pill. */
const MODE_IDS = [
  "follow-me",
  "active-track",
  "orbit",
  "quickshots",
  "obstacle-avoidance",
  "precision-landing",
  "terrain-following",
  "gesture-recognition",
  "panorama",
];

const QUICKSHOT_IDS = [
  "quickshot-dronie",
  "quickshot-rocket",
  "quickshot-circle",
  "quickshot-helix",
  "quickshot-boomerang",
];

export function ModeSelectorBar() {
  const activeBehavior = useSmartModeStore((s) => s.activeBehavior);
  const setActiveBehavior = useSmartModeStore((s) => s.setActiveBehavior);
  const features = useAvailableFeatures();

  // Only show enabled smart modes (A8 fix: was f.status !== "unavailable")
  const enabledIds = new Set(
    features
      .filter((f) => f.type === "smart-mode" && f.enabled)
      .map((f) => f.id)
  );

  // Check if any QuickShot is enabled
  const hasQuickShots = QUICKSHOT_IDS.some((id) => enabledIds.has(id));
  const isQuickShotActive = QUICKSHOT_IDS.some((id) => id === activeBehavior);

  const handleSelect = (modeId: string) => {
    // TODO(agent-api): POST /api/features/{modeId}/activate or deactivate
    if (modeId === activeBehavior) {
      setActiveBehavior(null);
    } else {
      setActiveBehavior(modeId);
    }
  };

  const handleQuickShotSelect = () => {
    // TODO(agent-api): POST /api/features/quickshots/activate or deactivate
    if (isQuickShotActive) {
      setActiveBehavior(null);
    } else {
      setActiveBehavior("quickshots");
    }
  };

  return (
    <div className="flex items-center gap-1.5 px-2 py-2 overflow-x-auto">
      {MODE_IDS.map((modeId) => {
        if (modeId === "quickshots") {
          if (!hasQuickShots) return null;
          return (
            <button
              key="quickshots"
              onClick={handleQuickShotSelect}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
                isQuickShotActive
                  ? "bg-accent-primary text-white border-accent-primary"
                  : "bg-bg-secondary text-text-secondary border-border-default hover:border-border-hover hover:text-text-primary"
              )}
            >
              <Camera className="w-3.5 h-3.5" />
              QuickShots
            </button>
          );
        }

        if (!enabledIds.has(modeId)) return null;

        const feature = features.find((f) => f.id === modeId);
        if (!feature) return null;

        // A7 fix: lookup by feature ID, not icon name
        const Icon = ICON_MAP[feature.id] ?? CircleDot;
        const isActive = activeBehavior === modeId;

        return (
          <button
            key={modeId}
            onClick={() => handleSelect(modeId)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border",
              isActive
                ? "bg-accent-primary text-white border-accent-primary"
                : "bg-bg-secondary text-text-secondary border-border-default hover:border-border-hover hover:text-text-primary"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {feature.name}
          </button>
        );
      })}
    </div>
  );
}
