/**
 * @module SimulationControls
 * @description Camera mode buttons, quick actions, history, and keyboard
 * shortcuts reference for the simulation panel. A history row replays a past
 * run by loading its saved plan; unsaved work in the shared workspace is
 * offered a save or an explicit discard first.
 * @license GPL-3.0-only
 */

"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ChevronRight,
  ChevronDown,
  Clock,
  Trash2,
  Keyboard,
  Pencil,
  FileDown,
  Play,
} from "lucide-react";
import type { SimHistoryEntry } from "@/lib/types";
import { formatDuration } from "@/lib/utils";
import { timeAgo } from "@/lib/plan-library";
import { computeFlightPlan } from "@/lib/simulation-utils";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { usePlannerStore } from "@/stores/planner-store";
import { applyPlanToWorkspace, saveActivePlanFromWorkspace, workspaceHasUnsavedChanges } from "@/lib/plan-workspace";
import { useSimulationStore } from "@/stores/simulation-store";
import { useToast } from "@/components/ui/toast";
import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";

interface ShortcutEntry {
  key: string;
  action: string;
}

interface SimulationControlsProps {
  onEditInPlanner: () => void;
  onExport: () => void;
  exportDisabled: boolean;
  historyEntries: SimHistoryEntry[];
  historyExpanded: boolean;
  onToggleHistory: () => void;
  onClearHistory: () => void;
  shortcutsExpanded: boolean;
  onToggleShortcuts: () => void;
  shortcuts: ShortcutEntry[];
}

export function SimulationControls({
  onEditInPlanner,
  onExport,
  exportDisabled,
  historyEntries,
  historyExpanded,
  onToggleHistory,
  onClearHistory,
  shortcutsExpanded,
  onToggleShortcuts,
  shortcuts,
}: SimulationControlsProps) {
  const t = useTranslations("simulate");
  const { toast } = useToast();

  // A history row whose replay waits on the unsaved-changes decision.
  const [pendingReplay, setPendingReplay] = useState<SimHistoryEntry | null>(null);

  // Load a past run's plan back into the workspace and restart playback.
  const startReplay = useCallback(
    (entry: SimHistoryEntry) => {
      const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === entry.planId);
      if (!plan || plan.waypoints.length < 2) {
        toast(t("planNotFound"), "error");
        return;
      }

      // Full workspace load: waypoints + the plan's geofence + rally.
      applyPlanToWorkspace(plan);

      const defaultSpeed = usePlannerStore.getState().defaultSpeed;
      const expected = computeFlightPlan(plan.waypoints, defaultSpeed).totalDuration;

      // Start playback once the 3D viewer has re-timed the store to the loaded
      // plan (it resets + sets totalDuration in its own effect on mission change).
      // Wait a couple of frames so that reset lands before play, then poll until
      // the store's duration matches this plan before restarting.
      let frames = 0;
      const startWhenReady = () => {
        frames += 1;
        const sim = useSimulationStore.getState();
        const ready =
          sim.totalDuration > 0 && Math.abs(sim.totalDuration - expected) < 0.001;
        if (ready && frames >= 2) {
          sim.resetPlayback();
          sim.play();
          return;
        }
        if (frames < 60) requestAnimationFrame(startWhenReady);
      };
      requestAnimationFrame(startWhenReady);
    },
    [toast, t],
  );

  // Replaying replaces the mission and restores or clears the fence, rally
  // points and POIs, so unsaved work is offered a save or an explicit discard
  // first, the same choice the plan library gives when switching plans.
  const handleReplay = useCallback(
    (entry: SimHistoryEntry) => {
      const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === entry.planId);
      if (!plan || plan.waypoints.length < 2) {
        toast(t("planNotFound"), "error");
        return;
      }
      if (workspaceHasUnsavedChanges()) {
        setPendingReplay(entry);
        return;
      }
      startReplay(entry);
    },
    [startReplay, toast, t],
  );

  const replayPending = (save: boolean) => {
    const entry = pendingReplay;
    setPendingReplay(null);
    if (!entry) return;
    if (save) saveActivePlanFromWorkspace();
    startReplay(entry);
  };

  return (
    <>
      {/* Quick Actions */}
      <div className="px-3 py-2 border-b border-border-default">
        <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider mb-2">
          {t("quickActions")}
        </h3>
        <div className="flex gap-1.5">
          <button
            onClick={onEditInPlanner}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-bg-tertiary/50 text-text-secondary hover:text-text-primary border border-border-default transition-colors cursor-pointer"
          >
            <Pencil size={10} />
            {t("editInPlanner")}
          </button>
          <button
            onClick={onExport}
            disabled={exportDisabled}
            className="flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 text-[10px] font-mono bg-bg-tertiary/50 text-text-secondary hover:text-text-primary border border-border-default transition-colors cursor-pointer disabled:opacity-50"
          >
            <FileDown size={10} />
            {t("export")}
          </button>
        </div>
      </div>

      {/* History (collapsible) */}
      {historyEntries.length > 0 && (
        <div className="border-b border-border-default">
          <button
            onClick={onToggleHistory}
            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-bg-tertiary transition-colors cursor-pointer"
          >
            {historyExpanded ? (
              <ChevronDown size={10} className="text-text-tertiary" />
            ) : (
              <ChevronRight size={10} className="text-text-tertiary" />
            )}
            <h3 className="text-[10px] font-mono text-text-tertiary uppercase tracking-wider">
              {t("history", { count: historyEntries.length })}
            </h3>
          </button>

          {historyExpanded && (
            <div className="px-3 pb-2">
              <div className="space-y-1">
                {historyEntries.map((entry) => (
                  <button
                    key={entry.id}
                    onClick={() => handleReplay(entry)}
                    title={t("replayRun")}
                    className="group w-full flex items-center gap-2 px-1.5 py-1 text-left hover:bg-bg-tertiary transition-colors cursor-pointer"
                  >
                    <Clock size={10} className="text-text-tertiary shrink-0 group-hover:hidden" />
                    <Play size={10} className="text-accent-primary shrink-0 hidden group-hover:block" />
                    <span className="text-[10px] font-mono text-text-primary truncate flex-1">
                      {entry.planName}
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {entry.waypointCount} wp
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {formatDuration(entry.duration)}
                    </span>
                    <span className="text-[10px] font-mono text-text-tertiary">
                      {timeAgo(entry.timestamp)}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={onClearHistory}
                className="flex items-center gap-1 mt-2 text-[10px] text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
              >
                <Trash2 size={10} />
                {t("clearHistory")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Keyboard Shortcuts (collapsible) */}
      <div className="px-3 py-2">
        <button
          onClick={onToggleShortcuts}
          className="w-full flex items-center gap-2 text-[10px] font-mono text-text-tertiary uppercase tracking-wider hover:text-text-secondary cursor-pointer"
        >
          <Keyboard size={12} />
          {t("keyboardShortcuts")}
          {shortcutsExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {shortcutsExpanded && (
          <div className="mt-2 space-y-1">
            {shortcuts.map((s) => (
              <div key={s.key} className="flex items-center gap-2">
                <kbd className="inline-block min-w-[28px] text-center px-1.5 py-0.5 bg-bg-tertiary rounded text-[10px] font-mono text-text-secondary">
                  {s.key}
                </kbd>
                <span className="text-xs text-text-tertiary">{s.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <UnsavedChangesDialog
        open={pendingReplay !== null}
        onSaveAndSwitch={() => replayPending(true)}
        onDiscardAndSwitch={() => replayPending(false)}
        onCancel={() => setPendingReplay(null)}
      />
    </>
  );
}
