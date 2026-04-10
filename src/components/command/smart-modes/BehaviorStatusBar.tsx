"use client";

/**
 * @module BehaviorStatusBar
 * @description Top bar showing the active smart mode name, execution state, and stop button.
 * @license GPL-3.0-only
 */

import { OctagonX, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { FEATURE_CATALOG } from "@/lib/agent/feature-catalog";
import type { BehaviorState } from "@/stores/smart-mode-store";

const STATE_LABELS: Record<BehaviorState, string> = {
  idle: "Idle",
  designating: "Designating target",
  searching: "Searching",
  tracking: "Tracking",
  executing: "Executing",
  paused: "Paused",
};

const STATE_COLORS: Record<BehaviorState, string> = {
  idle: "text-text-tertiary",
  designating: "text-status-warning",
  searching: "text-status-warning",
  tracking: "text-status-success",
  executing: "text-accent-primary",
  paused: "text-status-warning",
};

export function BehaviorStatusBar() {
  const activeBehavior = useSmartModeStore((s) => s.activeBehavior);
  const behaviorState = useSmartModeStore((s) => s.behaviorState);
  const clear = useSmartModeStore((s) => s.clear);
  const trackCount = useAgentCapabilitiesStore((s) => s.vision.track_count);

  if (!activeBehavior) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 bg-bg-secondary border border-border-default rounded-lg">
        <Circle className="w-3 h-3 text-text-tertiary" />
        <span className="text-sm text-text-tertiary">
          No active behavior. Select a mode below.
        </span>
      </div>
    );
  }

  const feature = FEATURE_CATALOG[activeBehavior];
  const name = feature?.name ?? activeBehavior;
  const stateLabel = behaviorState ? STATE_LABELS[behaviorState] : "Unknown";
  const stateColor = behaviorState ? STATE_COLORS[behaviorState] : "text-text-tertiary";

  const trackInfo = trackCount > 0 ? ` \u00b7 ${trackCount} target${trackCount !== 1 ? "s" : ""}` : "";

  return (
    <div className="flex items-center justify-between px-4 py-2 bg-bg-secondary border border-border-default rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
          Active
        </span>
        <span className="text-sm font-medium text-text-primary">{name}</span>
        <span className={cn("flex items-center gap-1.5 text-xs", stateColor)}>
          <Circle className="w-2 h-2 fill-current" />
          {stateLabel}{trackInfo}
        </span>
      </div>
      <button
        onClick={() => {
          // TODO(agent-api): POST /api/features/{activeBehavior}/deactivate
          clear();
        }}
        className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-status-error border border-status-error/30 rounded hover:bg-status-error/10 transition-colors"
      >
        <OctagonX className="w-3.5 h-3.5" />
        Stop
      </button>
    </div>
  );
}
