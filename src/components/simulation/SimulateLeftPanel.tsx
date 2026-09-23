/**
 * @module SimulateLeftPanel
 * @description Left panel for the Simulate tab. Contains only the FlightPlanLibrary
 * at full height. All simulation-specific sections live in the right panel (SimulationPanel).
 * @license GPL-3.0-only
 */
"use client";

import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { ChevronRight } from "lucide-react";
import { FlightPlanLibrary } from "@/components/library/FlightPlanLibrary";
import { saveActivePlanFromWorkspace } from "@/lib/plan-workspace";
import { SimReplayControl } from "./SimReplayControl";

interface SimulateLeftPanelProps {
  onPlanLoaded?: (plan: { name: string; droneId?: string }) => void;
}

export function SimulateLeftPanel({ onPlanLoaded }: SimulateLeftPanelProps) {
  const libraryCollapsed = usePlanLibraryStore((s) => s.libraryCollapsed);
  const toggleLibrary = usePlanLibraryStore((s) => s.toggleLibrary);

  if (libraryCollapsed) {
    return (
      <div className="w-10 shrink-0 flex flex-col items-center h-full border-r border-border-default bg-bg-secondary">
        <button
          onClick={toggleLibrary}
          className="p-2 mt-2 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title="Expand panel"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-64 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary overflow-hidden">
      <div className="flex-1 overflow-hidden">
        <FlightPlanLibrary context="simulate" onPlanLoaded={onPlanLoaded} onSave={saveActivePlanFromWorkspace} />
      </div>
      <div className="shrink-0 border-t border-border-default">
        <SimReplayControl />
      </div>
    </div>
  );
}
