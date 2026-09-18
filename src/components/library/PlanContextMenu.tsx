/**
 * @module PlanContextMenu
 * @description Right-click context menu for plans: Rename, Duplicate, Move, Export, Delete.
 * Uses current planner waypoints (not stale stored data) when exporting the active plan.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Trash2, FileDown, Pencil, FolderInput, FolderX, Folder } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useMissionStore } from "@/stores/mission-store";
import { useSimulationStore } from "@/stores/simulation-store";
import { useToast } from "@/components/ui/toast";
import { exportWaypointsFormat, exportQGCPlan, currentExportOptions } from "@/lib/mission-io";

interface PlanContextMenuProps {
  planId: string;
  x: number;
  y: number;
  onClose: () => void;
  /** Called when the active plan is renamed — syncs planner missionName state. */
  onPlanRenamed?: (name: string) => void;
}

export function PlanContextMenu({ planId, x, y, onClose, onPlanRenamed }: PlanContextMenuProps) {
  const t = useTranslations("library");
  const ref = useRef<HTMLDivElement>(null);
  const plans = usePlanLibraryStore((s) => s.plans);
  const folders = usePlanLibraryStore((s) => s.folders);
  const deletePlan = usePlanLibraryStore((s) => s.deletePlan);
  const duplicatePlan = usePlanLibraryStore((s) => s.duplicatePlan);
  const updatePlanName = usePlanLibraryStore((s) => s.updatePlanName);
  const movePlan = usePlanLibraryStore((s) => s.movePlan);
  const activePlanId = usePlanLibraryStore((s) => s.activePlanId);
  const clearMission = useMissionStore((s) => s.clearMission);
  const currentWaypoints = useMissionStore((s) => s.waypoints);
  const { toast } = useToast();

  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [moving, setMoving] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);

  const plan = plans.find((p) => p.id === planId);
  const isActivePlan = planId === activePlanId;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  useEffect(() => {
    if (renaming && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [renaming]);

  const handleDuplicate = useCallback(() => {
    duplicatePlan(planId);
    toast(t("planDuplicated"), "info");
    onClose();
  }, [duplicatePlan, planId, toast, onClose, t]);

  const handleDelete = useCallback(() => {
    if (isActivePlan) {
      clearMission();
      useSimulationStore.getState().reset();
    }
    deletePlan(planId);
    toast(t("planDeleted"), "info");
    onClose();
  }, [deletePlan, planId, isActivePlan, clearMission, toast, onClose, t]);

  // Use current planner waypoints for active plan, stored waypoints for others
  const getExportWaypoints = useCallback(() => {
    if (isActivePlan) return currentWaypoints;
    return plan?.waypoints ?? [];
  }, [isActivePlan, currentWaypoints, plan]);

  const handleExportWaypoints = useCallback(() => {
    if (!plan) return;
    exportWaypointsFormat(getExportWaypoints(), plan.name, currentExportOptions());
    toast(t("exportedWaypoints"), "success");
    onClose();
  }, [plan, getExportWaypoints, toast, onClose, t]);

  const handleExportPlan = useCallback(() => {
    if (!plan) return;
    // Export the plan's own saved fence/rally (not the live editor's).
    exportQGCPlan(getExportWaypoints(), plan.name, undefined, { geofence: plan.geofence, rally: plan.rally }, currentExportOptions());
    toast(t("exportedPlan"), "success");
    onClose();
  }, [plan, getExportWaypoints, toast, onClose, t]);

  const handleMove = useCallback((folderId: string | null) => {
    movePlan(planId, folderId);
    toast(t("planMoved"), "info");
    onClose();
  }, [movePlan, planId, toast, onClose, t]);

  const handleStartRename = useCallback(() => {
    if (!plan) return;
    setRenameValue(plan.name);
    setRenaming(true);
  }, [plan]);

  const handleRenameConfirm = useCallback(() => {
    if (renameValue.trim()) {
      updatePlanName(planId, renameValue.trim());
      // Sync planner state if renaming the active plan
      if (isActivePlan && onPlanRenamed) {
        onPlanRenamed(renameValue.trim());
      }
      toast(t("planRenamed"), "info");
    }
    setRenaming(false);
    onClose();
  }, [updatePlanName, planId, renameValue, isActivePlan, onPlanRenamed, toast, onClose, t]);

  if (!plan) return null;

  const items = [
    { id: "rename", label: t("rename"), icon: <Pencil size={12} />, action: handleStartRename },
    { id: "duplicate", label: t("duplicate"), icon: <Copy size={12} />, action: handleDuplicate },
    ...(folders.length > 0
      ? [{ id: "move", label: t("moveTo"), icon: <FolderInput size={12} />, action: () => setMoving(true) }]
      : []),
    { id: "div1", divider: true },
    { id: "export-wp", label: t("exportWaypoints"), icon: <FileDown size={12} />, action: handleExportWaypoints },
    { id: "export-plan", label: t("exportPlanFile"), icon: <FileDown size={12} />, action: handleExportPlan },
    { id: "div2", divider: true },
    { id: "delete", label: t("delete"), icon: <Trash2 size={12} />, action: handleDelete, danger: true },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-[2000] bg-bg-primary border border-border-default shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
    >
      {renaming ? (
        <div className="px-2 py-1">
          <input
            ref={renameRef}
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleRenameConfirm();
              if (e.key === "Escape") onClose();
            }}
            onBlur={handleRenameConfirm}
            placeholder={t("planName")}
            className="w-full px-2 py-1 text-xs bg-bg-tertiary border border-border-default text-text-primary outline-none"
          />
        </div>
      ) : moving ? (
        <>
          <button
            onClick={() => handleMove(null)}
            disabled={plan.folderId === null}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
          >
            <FolderX size={12} />
            {t("noFolder")}
          </button>
          {folders.length > 0 && <div className="my-1 border-t border-border-default" />}
          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => handleMove(folder.id)}
              disabled={plan.folderId === folder.id}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left text-text-primary hover:bg-bg-tertiary transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-default"
            >
              <Folder size={12} />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
        </>
      ) : (
        items.map((item) =>
          item.divider ? (
            <div key={item.id} className="my-1 border-t border-border-default" />
          ) : (
            <button
              key={item.id}
              onClick={item.action}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors cursor-pointer",
                item.danger
                  ? "text-status-error hover:bg-status-error/10"
                  : "text-text-primary hover:bg-bg-tertiary"
              )}
            >
              {item.icon}
              {item.label}
            </button>
          )
        )
      )}
    </div>
  );
}
