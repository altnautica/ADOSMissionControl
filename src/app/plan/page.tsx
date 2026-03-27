"use client";

/**
 * @module MissionPlannerPage
 * @description Top-level page component for the mission planner view.
 * Pure layout -- all logic lives in {@link usePlanner} and {@link useKeyboardShortcuts}.
 * @license GPL-3.0-only
 */

import { useCallback, useState } from "react";
import dynamic from "next/dynamic";
import { ChevronLeft } from "lucide-react";
import { MapToolbar } from "@/components/planner/MapToolbar";
import { MapContextMenu } from "@/components/planner/MapContextMenu";
import { MissionStatsBar } from "@/components/planner/MissionStatsBar";
import { FlightPlanLibrary } from "@/components/library/FlightPlanLibrary";
import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDroneManager } from "@/stores/drone-manager";
import { usePlannerStore } from "@/stores/planner-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { usePlanner } from "./use-planner";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { PlannerRightPanel } from "./PlannerRightPanel";

const PlannerMap = dynamic(() => import("@/components/planner/PlannerMap").then((m) => m.PlannerMap), { ssr: false });
const AltitudeProfile = dynamic(() => import("@/components/planner/AltitudeProfile").then((m) => m.AltitudeProfile), { ssr: false });

export default function MissionPlannerPage() {
  const p = usePlanner();
  const droneCount = useDroneManager((s) => s.drones.size);
  const hasDrone = droneCount > 0;
  const isDownloading = p.downloadState === "downloading";
  const { supports } = useFirmwareCapabilities();
  const showGeofence = !hasDrone || supports("supportsGeoFence");
  const showRally = !hasDrone || supports("supportsRally");

  const patternOpen = usePlannerStore((s) => s.patternSectionOpen);
  const setPatternSectionOpen = usePlannerStore((s) => s.setPatternSectionOpen);
  const [validationOpen, setValidationOpen] = useState(true);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const togglePattern = useCallback(() => setPatternSectionOpen(!patternOpen), [patternOpen, setPatternSectionOpen]);
  const toggleValidation = useCallback(() => setValidationOpen((v) => !v), []);
  const toggleTerrain = useCallback(() => setTerrainOpen((v) => !v), []);

  useKeyboardShortcuts({
    activeTool: p.activeTool, setActiveTool: p.setActiveTool, undo: p.undo, redo: p.redo,
    selectedWaypointId: p.selectedWaypointId, removeWaypoint: p.removeWaypoint, setSelectedWaypoint: p.setSelectedWaypoint,
    expandedWaypointId: p.expandedWaypointId, setExpandedWaypoint: p.setExpandedWaypoint,
    handleSave: p.handleSave, handleSaveAs: p.handleSaveAs, handleNewPlan: p.handleNewPlan, handleFocusSearch: p.handleFocusSearch,
    onToggleTerrain: p.toggleAltProfile, onTogglePatternEditor: togglePattern, onToggleValidation: toggleValidation,
  });

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <FlightPlanLibrary context="plan" onPlanLoaded={p.handlePlanLoaded} onSave={p.handleSave}
            onPlanRenamed={p.handlePlanRenamed} onDownloadFromDrone={p.handleDownloadFromDrone} isDownloading={isDownloading} hasDrone={hasDrone} />

          <div className="flex-1 relative min-w-0">
            <PlannerMap waypoints={p.waypoints} activeTool={p.activeTool} selectedWaypointId={p.selectedWaypointId}
              hasActivePlan={!!p.activePlanId} rallyPoints={p.rallyPoints} onMapClick={p.handleMapClick}
              onMapRightClick={p.handleMapRightClick} onWaypointClick={p.handleWaypointClick}
              onWaypointDragEnd={p.handleWaypointDragEnd} onWaypointRightClick={p.handleWaypointRightClick}
              onDrawingComplete={p.handleDrawingComplete} />
            <MapToolbar activeTool={p.activeTool} onToolChange={p.setActiveTool}
              canUndo={p.undoStack.length > 0} canRedo={p.redoStack.length > 0}
              onUndo={p.undo} onRedo={p.redo} onClearAll={p.handleClearAll} />
            <MissionStatsBar waypoints={p.waypoints} defaultSpeed={p.defaultSpeed} />
            <AltitudeProfile waypoints={p.waypoints} collapsed={p.altProfileCollapsed} onToggle={p.toggleAltProfile}
              selectedWaypointId={p.selectedWaypointId}
              onSelectWaypoint={(id) => { p.setSelectedWaypoint(id); p.setExpandedWaypoint(id); }} />
          </div>

          {!p.panelCollapsed && (
            <PlannerRightPanel p={p} showGeofence={showGeofence} showRally={showRally} hasDrone={hasDrone}
              patternOpen={patternOpen} validationOpen={validationOpen} terrainOpen={terrainOpen}
              togglePattern={togglePattern} toggleValidation={toggleValidation} toggleTerrain={toggleTerrain} />
          )}
          {p.panelCollapsed && (
            <button onClick={p.togglePanel}
              className="w-8 shrink-0 flex items-center justify-center border-l border-border-default bg-bg-secondary hover:bg-bg-tertiary cursor-pointer">
              <ChevronLeft size={14} className="text-text-tertiary" />
            </button>
          )}
          {p.contextMenu && (
            <MapContextMenu x={p.contextMenu.x} y={p.contextMenu.y} items={p.contextMenu.items}
              onSelect={p.handleContextAction} onClose={() => p.setContextMenu(null)} />
          )}
        </div>
      </div>

      <ConfirmDialog open={p.showClearConfirm} onConfirm={p.confirmClear} onCancel={() => p.setShowClearConfirm(false)}
        title="Discard Changes" message="This will remove all waypoints and mission data. This action cannot be undone."
        confirmLabel="Discard" variant="danger" />
      <UnsavedChangesDialog open={p.showDownloadConfirm} onSaveAndSwitch={p.handleSaveAndDownload}
        onDiscardAndSwitch={p.handleDiscardAndDownload} onCancel={p.handleCancelDownload} />
    </>
  );
}
