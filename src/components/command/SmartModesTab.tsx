"use client";

/**
 * @module SmartModesTab
 * @description Dynamic tab for smart mode vision features. Appears when vision
 * features are enabled on the connected agent. Layout: status bar, video + sidebar,
 * active behavior panel, mode selector.
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useSmartModeStore } from "@/stores/smart-mode-store";
import { useAgentCapabilitiesStore } from "@/stores/agent-capabilities-store";
import { BehaviorStatusBar } from "./smart-modes/BehaviorStatusBar";
import { FollowMePanel } from "./smart-modes/FollowMePanel";
import { OrbitPanel } from "./smart-modes/OrbitPanel";
import { QuickShotLauncher } from "./smart-modes/QuickShotLauncher";
import { ObstacleAvoidancePanel } from "./smart-modes/ObstacleAvoidancePanel";
import { ModeSelectorBar } from "./smart-modes/ModeSelectorBar";
import { VisionOverlay } from "./smart-modes/VisionOverlay";
import { TargetDesignation } from "./smart-modes/TargetDesignation";
import type { Detection } from "@/lib/agent/feature-types";

// Dynamic import for VideoFeedCard to avoid SSR issues with WebRTC/video APIs
const VideoFeedCard = dynamic(
  () => import("./shared/VideoFeedCard").then((m) => ({ default: m.VideoFeedCard })),
  { ssr: false }
);

/** Map behavior IDs to their control panel component. */
function ActiveBehaviorPanel({ behaviorId }: { behaviorId: string }) {
  switch (behaviorId) {
    case "follow-me":
    case "active-track":
      return <FollowMePanel />;
    case "orbit":
      return <OrbitPanel />;
    case "quickshots":
    case "quickshot-dronie":
    case "quickshot-rocket":
    case "quickshot-circle":
    case "quickshot-helix":
    case "quickshot-boomerang":
      return <QuickShotLauncher />;
    case "obstacle-avoidance":
      return <ObstacleAvoidancePanel />;
    default:
      return (
        <div className="p-4 text-sm text-text-tertiary">
          No configuration panel for this mode.
        </div>
      );
  }
}

/** Quick action buttons in the sidebar. */
function QuickActions() {
  const activeBehavior = useSmartModeStore((s) => s.activeBehavior);
  const behaviorState = useSmartModeStore((s) => s.behaviorState);
  const setBehaviorState = useSmartModeStore((s) => s.setBehaviorState);

  const isPaused = behaviorState === "paused";
  const isRunning = behaviorState === "tracking" || behaviorState === "executing";

  return (
    <div className="flex flex-col gap-2 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-text-tertiary">
        Quick Actions
      </h4>
      {activeBehavior && (
        <>
          {isRunning && (
            <button
              onClick={() => setBehaviorState("paused")}
              className="px-3 py-1.5 text-xs font-medium rounded bg-status-warning/10 text-status-warning border border-status-warning/30 hover:bg-status-warning/20 transition-colors"
            >
              Pause
            </button>
          )}
          {isPaused && (
            <button
              onClick={() => setBehaviorState("executing")}
              className="px-3 py-1.5 text-xs font-medium rounded bg-status-success/10 text-status-success border border-status-success/30 hover:bg-status-success/20 transition-colors"
            >
              Resume
            </button>
          )}
        </>
      )}
      {!activeBehavior && (
        <p className="text-xs text-text-tertiary">
          Select a mode below to see available actions.
        </p>
      )}
    </div>
  );
}

// Mock detections for demo mode (will come from agent /api/vision/state in production)
const MOCK_DETECTIONS: Detection[] = [
  { class: "Person", confidence: 0.94, bbox: { x: 400, y: 200, w: 120, h: 280 }, track_id: 1, designated: true },
  { class: "Person", confidence: 0.87, bbox: { x: 800, y: 250, w: 100, h: 240 }, track_id: 2, designated: false },
];

export function SmartModesTab() {
  const activeBehavior = useSmartModeStore((s) => s.activeBehavior);
  const engineState = useAgentCapabilitiesStore((s) => s.vision.engine_state);
  const visionActive = engineState === "active" || engineState === "ready";

  // In demo mode, show mock detections when vision is active
  const detections = useMemo<Detection[]>(() => {
    if (!visionActive || !activeBehavior) return [];
    return MOCK_DETECTIONS;
  }, [visionActive, activeBehavior]);

  // Show a notice if the vision engine is not ready
  if (engineState === "off" || engineState === "error") {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3 text-center">
        <p className="text-sm text-text-secondary">
          {engineState === "off"
            ? "Vision engine is not active. Enable vision features in the Features tab to use smart modes."
            : "Vision engine encountered an error. Check the agent logs for details."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4 h-full">
      {/* Top: Status bar */}
      <BehaviorStatusBar />

      {/* Middle: Video feed (left) + sidebar (right) */}
      <div className="flex gap-3 flex-1 min-h-0">
        {/* Video feed with vision overlay */}
        <div className="flex-1 min-w-0 relative">
          <VideoFeedCard className="h-full" />
          {detections.length > 0 && (
            <VisionOverlay
              detections={detections}
              frameWidth={1920}
              frameHeight={1080}
              containerWidth={640}
              containerHeight={360}
              statusText={activeBehavior ? `${activeBehavior.toUpperCase()} - TRACKING` : undefined}
            />
          )}
          {visionActive && activeBehavior && (
            <TargetDesignation
              enabled={true}
              frameWidth={1920}
              frameHeight={1080}
              onDesignate={(x, y, fw, fh) => {
                // TODO(agent-api): POST /api/vision/target { x, y, frame_width: fw, frame_height: fh }
                console.log("[Vision] Designate target:", { x, y, fw, fh });
              }}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 flex flex-col gap-3 overflow-y-auto">
          <QuickActions />

          {/* Active behavior controls below quick actions in sidebar */}
          {activeBehavior && (
            <div className="border border-border-default rounded-lg bg-bg-secondary overflow-hidden">
              <ActiveBehaviorPanel behaviorId={activeBehavior} />
            </div>
          )}
        </div>
      </div>

      {/* Bottom: Mode selector */}
      <div className="border border-border-default rounded-lg bg-bg-secondary">
        <ModeSelectorBar />
      </div>
    </div>
  );
}
