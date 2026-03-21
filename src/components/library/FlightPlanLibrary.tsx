/**
 * @module FlightPlanLibrary
 * @description Left panel for browsing, organizing, and managing saved flight plans.
 * Shared between Plan and Simulate tabs with context-appropriate behavior.
 * Owns the unsaved-changes dirty check when switching plans.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo, useCallback, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useToast } from "@/components/ui/toast";
import { filterPlans, sortPlans } from "@/lib/plan-library";
import { importMissionFile } from "@/lib/mission-io";
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
  onPlanLoaded?: (plan: { name: string; droneId?: string; suiteType?: string }) => void;
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
  const setActivePlan = usePlanLibraryStore((s) => s.setActivePlan);
  const toggleLibrary = usePlanLibraryStore((s) => s.toggleLibrary);

  const setWaypoints = useMissionStore((s) => s.setWaypoints);
  const clearMission = useMissionStore((s) => s.clearMission);
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  // Unsaved changes dialog state
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingPlanId, setPendingPlanId] = useState<string | null>(null);

  const filteredPlans = useMemo(
    () => sortPlans(filterPlans(plans, searchQuery), sortBy, sortDirection),
    [plans, searchQuery, sortBy, sortDirection]
  );

  const handleNewPlan = useCallback(() => {
    createPlan();
    clearMission();
    onPlanLoaded?.({ name: t("untitledPlan") });
    toast(t("newPlanCreated"), "info");
  }, [createPlan, clearMission, onPlanLoaded, toast]);

  /** Load a plan into the planner — no dirty check, used after save/discard. */
  const loadPlan = useCallback(
    (planId: string) => {
      const plan = plans.find((p) => p.id === planId);
      if (!plan) return;
      setActivePlan(planId);
      setWaypoints(plan.waypoints);
      usePlanLibraryStore.getState().setSavedSnapshot(JSON.stringify(plan.waypoints));
      onPlanLoaded?.({
        name: plan.name,
        droneId: plan.metadata.droneId,
        suiteType: plan.metadata.suiteType,
      });
    },
    [plans, setActivePlan, setWaypoints, onPlanLoaded]
  );

  /** Select a plan — checks for unsaved changes first. */
  const handleSelectPlan = useCallback(
    (planId: string) => {
      // Clicking the already-active plan is a no-op
      if (planId === activePlanId) return;

      // If current plan has unsaved changes, show dialog
      if (isDirty && activePlanId) {
        setPendingPlanId(planId);
        setShowUnsavedDialog(true);
        return;
      }

      loadPlan(planId);
    },
    [activePlanId, isDirty, loadPlan]
  );

  /** Save current plan, then switch to pending. */
  const handleSaveAndSwitch = useCallback(() => {
    onSave?.();
    if (pendingPlanId) {
      loadPlan(pendingPlanId);
    }
    setShowUnsavedDialog(false);
    setPendingPlanId(null);
  }, [onSave, pendingPlanId, loadPlan]);

  /** Discard current changes and switch to pending. */
  const handleDiscardAndSwitch = useCallback(() => {
    if (pendingPlanId) {
      loadPlan(pendingPlanId);
    }
    setShowUnsavedDialog(false);
    setPendingPlanId(null);
  }, [pendingPlanId, loadPlan]);

  /** Cancel the switch — stay on current plan. */
  const handleCancelSwitch = useCallback(() => {
    setShowUnsavedDialog(false);
    setPendingPlanId(null);
  }, []);

  const handleImport = useCallback(async () => {
    fileRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const result = await importMissionFile(file);
        const name = result.metadata?.name || file.name.replace(/\.[^.]+$/, "");
        createPlan(name, result.waypoints, {
          droneId: result.metadata?.droneId,
          suiteType: result.metadata?.suiteType,
        });
        setWaypoints(result.waypoints);
        onPlanLoaded?.({ name, droneId: result.metadata?.droneId, suiteType: result.metadata?.suiteType });
        toast(t("importedPlan", { name, count: result.waypoints.length }), "success");
      } catch {
        toast(t("importFailed"), "error");
      }
      e.target.value = "";
    },
    [createPlan, setWaypoints, onPlanLoaded, toast]
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
        open={showUnsavedDialog}
        onSaveAndSwitch={handleSaveAndSwitch}
        onDiscardAndSwitch={handleDiscardAndSwitch}
        onCancel={handleCancelSwitch}
      />
    </>
  );
}
