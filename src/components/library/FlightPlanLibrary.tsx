/**
 * @module FlightPlanLibrary
 * @description Left panel for browsing, organizing, and managing saved flight plans.
 * Shared between Plan and Simulate tabs with context-appropriate behavior.
 * Owns the unsaved-changes check before switching plans, starting a new plan
 * or importing one.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useToast } from "@/components/ui/toast";
import { filterPlans, sortPlans } from "@/lib/plan-library";
import {
  applyPlanToWorkspace,
  clearPlanWorkspace,
  saveActivePlanFromWorkspace,
  workspaceHasUnsavedChanges,
} from "@/lib/plan-workspace";
import { importMissionFile } from "@/lib/mission-io";
import { withImportedFenceZones } from "@/lib/mission/qgc-plan-extras";
import { useGeofenceStore } from "@/stores/geofence-store";
import { PlanLibraryHeader } from "./PlanLibraryHeader";
import { PlanSearchBar } from "./PlanSearchBar";
import { PlanTree } from "./PlanTree";
import { PlanLibraryFooter } from "./PlanLibraryFooter";
import { PlanLibraryEmpty } from "./PlanLibraryEmpty";
import { UnsavedChangesDialog } from "./UnsavedChangesDialog";

interface FlightPlanLibraryProps {
  /** "plan" enables editing behavior, "simulate" enables play behavior */
  context: "plan" | "simulate";
  /** Called when a plan is loaded (for plan tab to sync local state) */
  onPlanLoaded?: (plan: { name: string; droneId?: string }) => void;
  /** Called to save the current plan (triggers handleSave in usePlanner) */
  onSave?: () => void;
  /** Called when the active plan is renamed via context menu */
  onPlanRenamed?: (name: string) => void;
  /** Called to download mission from connected drone */
  onDownloadFromDrone?: () => void;
  /** Whether a download from drone is in progress */
  isDownloading?: boolean;
  /** Whether any drone is connected */
  hasDrone?: boolean;
}

/** The workspace-replacing action waiting on the unsaved-changes answer. */
type PendingAction = { kind: "switch"; planId: string } | { kind: "new" } | { kind: "import" };

export function FlightPlanLibrary({ context, onPlanLoaded, onSave, onPlanRenamed, onDownloadFromDrone, isDownloading, hasDrone }: FlightPlanLibraryProps) {
  const t = useTranslations("library");
  const plans = usePlanLibraryStore((s) => s.plans);
  const folders = usePlanLibraryStore((s) => s.folders);
  const activePlanId = usePlanLibraryStore((s) => s.activePlanId);
  const isDirty = usePlanLibraryStore((s) => s.isDirty);
  const libraryCollapsed = usePlanLibraryStore((s) => s.libraryCollapsed);
  const searchQuery = usePlanLibraryStore((s) => s.searchQuery);
  const sortBy = usePlanLibraryStore((s) => s.sortBy);
  const sortDirection = usePlanLibraryStore((s) => s.sortDirection);
  const expandedFolders = usePlanLibraryStore((s) => s.expandedFolders);

  const createPlan = usePlanLibraryStore((s) => s.createPlan);
  const toggleLibrary = usePlanLibraryStore((s) => s.toggleLibrary);

  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // The action held back while the unsaved-changes dialog asks.
  const [pending, setPending] = useState<PendingAction | null>(null);

  const filteredPlans = useMemo(
    () => sortPlans(filterPlans(plans, searchQuery), sortBy, sortDirection),
    [plans, searchQuery, sortBy, sortDirection]
  );

  /** Start a new plan with an empty workspace — no dirty check. */
  const startNewPlan = useCallback(() => {
    createPlan();
    clearPlanWorkspace();
    onPlanLoaded?.({ name: t("untitledPlan") });
    toast(t("newPlanCreated"), "info");
  }, [createPlan, onPlanLoaded, toast, t]);

  /** Load a plan into the planner — no dirty check, used after save/discard. */
  const loadPlan = useCallback(
    (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      // Restores waypoints + geofence + rally + fits the map in one place.
      applyPlanToWorkspace(plan);
      onPlanLoaded?.({
        name: plan.name,
        droneId: plan.metadata.droneId,
      });
    },
    [plans, onPlanLoaded]
  );

  /** Run a pending action now (after save/discard, or when nothing is unsaved). */
  const runAction = useCallback(
    (action: PendingAction) => {
      if (action.kind === "switch") loadPlan(action.planId);
      else if (action.kind === "new") startNewPlan();
      else fileRef.current?.click();
    },
    [loadPlan, startNewPlan],
  );

  /** Run an action that replaces the workspace, asking first when it holds
   *  unsaved edits to the active plan or a never-saved workspace. */
  const guardAction = useCallback(
    (action: PendingAction) => {
      if (workspaceHasUnsavedChanges()) {
        setPending(action);
        return;
      }
      runAction(action);
    },
    [runAction],
  );

  /** Select a plan — checks for unsaved changes first. */
  const handleSelectPlan = useCallback(
    (planId: string) => {
      // Clicking the already-active plan is a no-op
      if (planId === activePlanId) return;
      guardAction({ kind: "switch", planId });
    },
    [activePlanId, guardAction]
  );

  const handleNewPlan = useCallback(() => guardAction({ kind: "new" }), [guardAction]);
  const handleImport = useCallback(() => guardAction({ kind: "import" }), [guardAction]);

  /** Save the current plan, then run the pending action. The save goes straight
   *  from the workspace, so it works on every surface (Simulate has no
   *  page-level save handler) and completes before the action replaces it. */
  const handleSaveAndSwitch = useCallback(() => {
    saveActivePlanFromWorkspace();
    if (pending) runAction(pending);
    setPending(null);
  }, [pending, runAction]);

  /** Discard current changes and run the pending action. */
  const handleDiscardAndSwitch = useCallback(() => {
    if (pending) runAction(pending);
    setPending(null);
  }, [pending, runAction]);

  /** Cancel — stay on the current plan. */
  const handleCancelSwitch = useCallback(() => {
    setPending(null);
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const result = await importMissionFile(file);
        const name = result.metadata?.name || file.name.replace(/\.[^.]+$/, "");
        // A file that parses to zero waypoints (e.g. a polygon-only KML, an
        // unsupported complex-item plan, or an empty CSV) must not create a
        // silent empty plan with a success toast.
        if (result.waypoints.length === 0) {
          toast(t("importNoWaypoints", { name }), "warning");
          e.target.value = "";
          return;
        }
        const geofence = result.geofence
          ?? (result.fenceZones
            ? withImportedFenceZones(useGeofenceStore.getState().snapshot(), result.fenceZones)
            : undefined);
        const planId = createPlan(name, result.waypoints, {
          droneId: result.metadata?.droneId,
        }, { geofence, rally: result.rally, pois: result.pois });
        const plan = usePlanLibraryStore.getState().plans.find((p) => p.id === planId);
        if (plan) applyPlanToWorkspace(plan);
        onPlanLoaded?.({ name, droneId: result.metadata?.droneId });
        toast(t("importedPlan", { name, count: result.waypoints.length }), "success");
        for (const warning of result.warnings ?? []) toast(warning, "warning");
      } catch {
        toast(t("importFailed"), "error");
      }
      e.target.value = "";
    },
    [createPlan, onPlanLoaded, toast, t]
  );

  if (libraryCollapsed) {
    return (
      <div className="w-10 shrink-0 flex flex-col items-center h-full border-r border-border-default bg-bg-secondary">
        <button
          onClick={toggleLibrary}
          className="p-2 mt-2 text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title={t("expandFlightPlans")}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="w-64 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
        <PlanLibraryHeader onNew={handleNewPlan} onCollapse={toggleLibrary} />
        <PlanSearchBar />

        <div className="flex-1 overflow-y-auto">
          {filteredPlans.length === 0 && !searchQuery ? (
            <PlanLibraryEmpty onNew={handleNewPlan} onImport={handleImport} onDownloadFromDrone={onDownloadFromDrone} isDownloading={isDownloading} hasDrone={hasDrone} />
          ) : filteredPlans.length === 0 ? (
            <div className="text-xs text-text-tertiary text-center py-4">
              {t("noPlansMatchSearch")}
            </div>
          ) : (
            <PlanTree
              plans={filteredPlans}
              folders={folders}
              activePlanId={activePlanId}
              isDirty={isDirty}
              expandedFolders={expandedFolders}
              context={context}
              onSelect={handleSelectPlan}
              onSave={onSave}
              onPlanRenamed={onPlanRenamed}
            />
          )}
        </div>

        <PlanLibraryFooter count={plans.length} onImport={handleImport} onDownloadFromDrone={onDownloadFromDrone} isDownloading={isDownloading} hasDrone={hasDrone} />

        <input
          ref={fileRef}
          type="file"
          accept=".altmission,.waypoints,.plan,.json,.kml,.kmz,.csv"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      <UnsavedChangesDialog
        open={pending !== null}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onCancel={handleCancelSwitch}
      />
    </>
  );
}
