"use client";

/**
 * @module MissionPlannerPage
 * @description Top-level page component for the mission planner view.
 * Pure layout -- all logic lives in {@link usePlanner} and {@link useKeyboardShortcuts}.
 * @license GPL-3.0-only
 */

import { useCallback, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { ChevronLeft } from "lucide-react";
import { MapToolbar } from "@/components/planner/MapToolbar";
import { CoordinateWidget } from "@/components/planner/CoordinateWidget";
import { PlaceSearchBox, FOCUS_PLACE_SEARCH_EVENT } from "@/components/planner/PlaceSearchBox";
import { MapContextMenu } from "@/components/planner/MapContextMenu";
import { OverlayPanel } from "@/components/planner/OverlayPanel";
import { DownloadAreaPanel } from "@/components/planner/DownloadAreaPanel";
import { MissionStatsBar } from "@/components/planner/MissionStatsBar";
import { FlightPlanLibrary } from "@/components/library/FlightPlanLibrary";
import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useDroneManager } from "@/stores/drone-manager";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { readPlanFromHash } from "@/lib/plan-share";
import { restoreSharedPlanExtras } from "@/lib/plan-workspace";
import { useSettingsStore } from "@/stores/settings-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { registerCommandProvider } from "@/lib/command-palette-registry";
import { setClipboard, getClipboard } from "@/lib/waypoint-clipboard";
import { randomId } from "@/lib/utils";
import { usePlanner } from "./use-planner";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { buildPlannerCommands, type PlannerCommandHandlers } from "./planner-commands";
import { PlannerRightPanel } from "./PlannerRightPanel";

const PlannerMap = dynamic(() => import("@/components/planner/PlannerMap").then((m) => m.PlannerMap), { ssr: false });
const AltitudeProfile = dynamic(() => import("@/components/planner/AltitudeProfile").then((m) => m.AltitudeProfile), { ssr: false });

export default function MissionPlannerPage() {
  const t = useTranslations("planner");
  const p = usePlanner();
  const droneCount = useDroneManager((s) => s.drones.size);
  const hasDrone = droneCount > 0;
  const hasActivePlan = !!p.activePlanId;
  const isDownloading = p.downloadState === "downloading";
  const { supports } = useFirmwareCapabilities();
  const showGeofence = !hasDrone || supports("supportsGeoFence");
  const showRally = !hasDrone || supports("supportsRally");

  // The altitude profile docks at the very bottom (full width). Lift the
  // bottom-left stats bar and bottom-right coordinate widget above it so the
  // profile never occludes them — collapsed shows only its header, expanded
  // adds the chart.
  const hasProfile = hasActivePlan && p.waypoints.length > 0;
  const bottomLift = hasProfile ? (p.altProfileCollapsed ? 48 : 160) : undefined;

  const patternOpen = usePlannerStore((s) => s.patternSectionOpen);
  const setPatternSectionOpen = usePlannerStore((s) => s.setPatternSectionOpen);
  const mapBounds = usePlannerStore((s) => s.mapBounds);
  const mapZoom = usePlannerStore((s) => s.mapZoom);
  const mapTileSource = useSettingsStore((s) => s.mapTileSource);
  const [validationOpen, setValidationOpen] = useState(true);
  const [terrainOpen, setTerrainOpen] = useState(false);
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  // The overlay and download panels dock at the same spot, so they are mutually
  // exclusive — opening one closes the other.
  const toggleOverlayPanel = useCallback(() => {
    setOverlayPanelOpen((v) => !v);
    setDownloadPanelOpen(false);
  }, []);
  const toggleDownloadPanel = useCallback(() => {
    setDownloadPanelOpen((v) => !v);
    setOverlayPanelOpen(false);
  }, []);
  // Load a shared plan from the URL fragment (#plan=...) on first mount. Non-destructive:
  // it only applies when the current mission is empty, so a share link can never clobber
  // in-progress work. The fragment is then cleared so a refresh does not reload it.
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.hash) return;
    const shared = readPlanFromHash(window.location.hash);
    if (shared) {
      const ms = useMissionStore.getState();
      if (ms.waypoints.length === 0) {
        ms.setWaypoints(shared.waypoints);
        p.setMissionName(shared.metadata.name);
        restoreSharedPlanExtras(shared);
      }
    }
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const togglePattern = useCallback(() => setPatternSectionOpen(!patternOpen), [patternOpen, setPatternSectionOpen]);
  const toggleValidation = useCallback(() => setValidationOpen((v) => !v), []);
  const toggleTerrain = useCallback(() => setTerrainOpen((v) => !v), []);

  useKeyboardShortcuts({
    activeTool: p.activeTool, setActiveTool: p.setActiveTool, undo: p.undo, redo: p.redo,
    selectedWaypointId: p.selectedWaypointId, removeWaypoint: p.removeWaypoint, setSelectedWaypoint: p.setSelectedWaypoint,
    expandedWaypointId: p.expandedWaypointId, setExpandedWaypoint: p.setExpandedWaypoint,
    handleSave: p.handleSave, handleSaveAs: p.handleSaveAs, handleNewPlan: p.handleNewPlan, handleFocusSearch: p.handleFocusSearch,
    onToggleTerrain: p.toggleAltProfile, onTogglePatternEditor: togglePattern, onToggleValidation: toggleValidation,
    onToggleOverlays: toggleOverlayPanel,
    onFocusPlaceSearch: () => document.dispatchEvent(new CustomEvent(FOCUS_PLACE_SEARCH_EVENT)),
    onNudgeSelected: (dLat, dLon) => {
      if (!p.selectedWaypointId) return;
      const wp = p.waypoints.find((w) => w.id === p.selectedWaypointId);
      if (wp) p.updateWaypoint(p.selectedWaypointId, { lat: wp.lat + dLat, lon: wp.lon + dLon });
    },
    onCopy: () => {
      if (!p.selectedWaypointId) return;
      const wp = p.waypoints.find((w) => w.id === p.selectedWaypointId);
      if (wp) setClipboard([wp]);
    },
    onPaste: () => {
      const clip = getClipboard();
      if (clip.length === 0) return;
      // Paste copies slightly offset so they are visible and selectable.
      const pasted = clip.map((wp) => ({ ...wp, id: randomId(), lat: wp.lat + 0.0002, lon: wp.lon + 0.0002 }));
      const ms = useMissionStore.getState();
      ms.setWaypoints([...ms.waypoints, ...pasted]);
    },
  });

  // Contribute planner verbs to the ⌘K command palette while this page is
  // mounted. The provider closes over the current handlers and re-registers if
  // any change (the planner handlers are memoized, so this normally runs once).
  const {
    setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
    handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
    toggleAltProfile: pToggleAltProfile,
  } = p;
  useEffect(() => {
    const handlers: PlannerCommandHandlers = {
      setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
      handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
      toggleTerrain: pToggleAltProfile, togglePattern, toggleValidation, toggleOverlays: toggleOverlayPanel,
    };
    const category = t("paletteCategory");
    return registerCommandProvider((ctx) =>
      ctx.pathname.startsWith("/plan") ? buildPlannerCommands(handlers, (k) => t(k), category, ctx.query) : [],
    );
  }, [pSetActiveTool, pUndo, pRedo, pHandleSave, pHandleSaveAs, pHandleNewPlan, pToggleAltProfile, togglePattern, toggleValidation, toggleOverlayPanel, t]);

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex-1 flex overflow-hidden">
          <FlightPlanLibrary context="plan" onPlanLoaded={p.handlePlanLoaded} onSave={p.handleSave}
            onPlanRenamed={p.handlePlanRenamed} onDownloadFromDrone={p.handleDownloadFromDrone} isDownloading={isDownloading} hasDrone={hasDrone} />

          <div className="flex-1 relative min-w-0">
            <PlannerMap waypoints={p.waypoints} activeTool={p.activeTool} selectedWaypointId={p.selectedWaypointId}
              hasActivePlan={hasActivePlan} rallyPoints={p.rallyPoints} onMapClick={p.handleMapClick}
              onMapRightClick={p.handleMapRightClick} onWaypointClick={p.handleWaypointClick}
              onWaypointDragEnd={p.handleWaypointDragEnd} onWaypointRightClick={p.handleWaypointRightClick}
              onDrawingComplete={p.handleDrawingComplete} />
            {hasActivePlan && <PlaceSearchBox />}
            {hasActivePlan && <CoordinateWidget bottomOffset={bottomLift} />}
            {hasActivePlan && (
              <MapToolbar activeTool={p.activeTool} onToolChange={p.setActiveTool}
                canUndo={p.canUndo} canRedo={p.canRedo}
                onUndo={p.undo} onRedo={p.redo} onClearAll={p.handleClearAll}
                onToggleOverlays={toggleOverlayPanel} overlayPanelOpen={overlayPanelOpen}
                onToggleDownload={toggleDownloadPanel} downloadPanelOpen={downloadPanelOpen} />
            )}
            {hasActivePlan && overlayPanelOpen && <OverlayPanel onClose={() => setOverlayPanelOpen(false)} />}
            {hasActivePlan && downloadPanelOpen && (
              <DownloadAreaPanel
                bounds={mapBounds ?? { north: 13.0, south: 12.9, east: 77.7, west: 77.5 }}
                currentZoom={mapZoom}
                currentProvider={mapTileSource}
                onClose={() => setDownloadPanelOpen(false)}
              />
            )}
            {hasActivePlan && <MissionStatsBar waypoints={p.waypoints} defaultSpeed={p.defaultSpeed} bottomOffset={bottomLift} />}
            {hasActivePlan && (
              <AltitudeProfile waypoints={p.waypoints} collapsed={p.altProfileCollapsed} onToggle={p.toggleAltProfile}
                selectedWaypointId={p.selectedWaypointId}
                onSelectWaypoint={(id) => { p.setSelectedWaypoint(id); p.setExpandedWaypoint(id); }} />
            )}
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
        title={t("discardChanges")} message={t("discardChangesBody")}
        confirmLabel={t("discard")} variant="danger" />
      <ConfirmDialog open={p.showPatternApplyConfirm} onConfirm={p.applyPatternConfirmed}
        onCancel={() => p.setShowPatternApplyConfirm(false)}
        title={t("applyConfirmTitle")} message={t("applyConfirmBody")}
        confirmLabel={t("applyConfirmButton")} variant="danger" />
      <UnsavedChangesDialog open={p.showDownloadConfirm} onSaveAndSwitch={p.handleSaveAndDownload}
        onDiscardAndSwitch={p.handleDiscardAndDownload} onCancel={p.handleCancelDownload} />
    </>
  );
}
