"use client";

/**
 * @module SimulatePage
 * @description Dedicated simulation page. A NON-DESTRUCTIVE, read-only view of
 * whatever is currently in the shared mission store: if waypoints exist it
 * renders the 3D CesiumJS simulation of them (regardless of whether a saved plan
 * is active), and if the mission is empty it shows a calm empty state that links
 * back to the Plan tab. The page itself never edits or clears the shared
 * mission; loading a saved plan (library or run history) asks before it
 * replaces unsaved work. Only the playback state (simulation-store) is reset on
 * unmount.
 * @license GPL-3.0-only
 */

import { useState, useEffect } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ChevronLeft, Waypoints } from "lucide-react";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useSimulationKeyboard } from "@/hooks/use-simulation-keyboard";
import { SimulateLeftPanel } from "@/components/simulation/SimulateLeftPanel";

const SimulationViewer = dynamic(
  () =>
    import("@/components/simulation/SimulationViewer").then((m) => m.SimulationViewer),
  { ssr: false }
);
const SimulationPanel = dynamic(
  () =>
    import("@/components/simulation/SimulationPanel").then((m) => m.SimulationPanel),
  { ssr: false }
);

export default function SimulatePage() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const defaultSpeed = usePlannerStore((s) => s.defaultSpeed);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const router = useRouter();

  useSimulationKeyboard(true);

  const hasMission = waypoints.length > 0;

  // Reset simulation PLAYBACK state on unmount (navigating away). This only
  // touches the simulation-store (playhead / speed / running flag); it never
  // clears the shared mission, so switching between Plan and Simulate is safe
  // even for an unsaved, still-being-edited mission.
  useEffect(() => {
    return () => { useSimulationStore.getState().reset(); };
  }, []);

  return (
    <div className="relative flex-1 flex h-full overflow-hidden">
      {/* Left panel — always available so a saved plan can be loaded into the view */}
      <SimulateLeftPanel />

      {hasMission ? (
        <>
          {/* 3D Viewer (the mission-warning banner mounts inside it, top-center) */}
          <SimulationViewer waypoints={waypoints} defaultSpeed={defaultSpeed} defaultFrame={defaultFrame} />

          {/* Right panel */}
          {!panelCollapsed && (
            <SimulationPanel
              waypoints={waypoints}
              onClose={() => setPanelCollapsed(true)}
            />
          )}

          {/* Collapsed panel toggle */}
          {panelCollapsed && (
            <button
              onClick={() => setPanelCollapsed(false)}
              className="w-8 shrink-0 flex items-center justify-center border-l border-border-default bg-bg-secondary hover:bg-bg-tertiary cursor-pointer"
            >
              <ChevronLeft size={14} className="text-text-tertiary" />
            </button>
          )}
        </>
      ) : (
        <SimulateEmptyState onPlan={() => router.push("/plan")} />
      )}
    </div>
  );
}

/**
 * Calm, read-only empty state shown when the shared mission has no waypoints.
 * It is purely informational — it never mutates any store — and points the
 * operator back to the Plan tab to build a mission first.
 */
function SimulateEmptyState({ onPlan }: { onPlan: () => void }) {
  const tSim = useTranslations("simulate");
  return (
    <div className="flex-1 flex items-center justify-center h-full bg-bg-primary">
      <div className="flex flex-col items-center text-center max-w-sm px-6">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-border-default bg-bg-secondary">
          <Waypoints size={26} className="text-text-tertiary" />
        </div>
        <p className="text-base font-semibold text-text-primary mb-1.5">
          {tSim("emptyTitle")}
        </p>
        <p className="text-sm text-text-tertiary mb-5 leading-relaxed">
          {tSim("emptyBody")}
        </p>
        <button
          onClick={onPlan}
          className="inline-flex items-center gap-1.5 rounded-md border border-border-default bg-bg-secondary px-4 py-2 text-sm font-medium text-accent-primary hover:bg-bg-tertiary transition-colors cursor-pointer"
        >
          {tSim("emptyAction")}
        </button>
      </div>
    </div>
  );
}
