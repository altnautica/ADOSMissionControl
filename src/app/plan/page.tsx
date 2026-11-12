"use client";

/**
 * @module MissionPlannerPage
 * @description Top-level page component for the mission planner view.
 * Pure layout -- all logic lives in {@link usePlanner} and {@link useKeyboardShortcuts}.
 *
 * Two states. With no plan open, the plan library docks at the left of a
 * full-bleed map and is the way in. With a plan open, the planner bar runs
 * across the top, the plan outline and the inspector sit either side of the
 * map, the tool rail floats over it and the dock runs along its bottom; the
 * library is then a sheet over the map's left edge (Plans button, Ctrl/Cmd+O).
 * @license GPL-3.0-only
 */

import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { MapToolbar } from "@/components/planner/MapToolbar";
import { CoordinateWidget } from "@/components/planner/CoordinateWidget";
import { PlaceSearchBox, FOCUS_PLACE_SEARCH_EVENT } from "@/components/planner/PlaceSearchBox";
import { MapContextMenu } from "@/components/planner/MapContextMenu";
import { OverlayPanel } from "@/components/planner/OverlayPanel";
import { DownloadAreaPanel } from "@/components/planner/DownloadAreaPanel";
import { PlanOutline } from "@/components/planner/outline/PlanOutline";
import { PlannerInspector } from "@/components/planner/inspector/PlannerInspector";
import { PlannerDock, DOCK_STRIP_HEIGHT, DOCK_DRAWER_HEIGHT } from "@/components/planner/dock/PlannerDock";
import { SendToVehicleDialog } from "@/components/planner/SendToVehicleDialog";
import { FlightPlanLibrary } from "@/components/library/FlightPlanLibrary";
import { UnsavedChangesDialog } from "@/components/library/UnsavedChangesDialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { useToast } from "@/components/ui/toast";
import { SidePanel } from "@/components/ui/side-panel";
import { usePlannerStore, type DockTab } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { usePreflightChecklistStore } from "@/stores/preflight-checklist-store";
import { usePatternStore } from "@/stores/pattern-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFirmwareCapabilities } from "@/hooks/use-firmware-capabilities";
import { useNarrowViewport } from "@/hooks/use-narrow-viewport";
import { registerCommandProvider } from "@/lib/command-palette-registry";
import { setClipboard, getClipboard } from "@/lib/waypoint-clipboard";
import { MAP_OVERLAY_Z } from "@/lib/map-overlay-z";
import { startGroundElevationSync } from "@/lib/mission/sample-ground-elevations";
import { isDrawingTool } from "@/lib/planner-shortcuts";
import { usePlanner } from "./use-planner";
import { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
import { buildPlannerCommands, type PlannerCommandHandlers } from "./planner-commands";
import { PlannerBar, useSendable } from "./PlannerBar";
import { usePlannerShareImport } from "./use-planner-share-import";
import { useSharedPlanLink } from "./use-shared-plan-link";
import { usePlannedHomeSeed } from "./use-planned-home-seed";
import { nudgeWaypoints, pasteWaypoints } from "./waypoint-edits";
import { planElementSupport } from "./plan-element-support";

const PlannerMap = dynamic(() => import("@/components/planner/PlannerMap").then((m) => m.PlannerMap), { ssr: false });
const Planner3DView = dynamic(() => import("@/components/planner/Planner3DView").then((m) => m.Planner3DView), { ssr: false });

/** The library's own search-focus event (see FlightPlanLibrary's search bar). */
const FOCUS_LIBRARY_SEARCH_EVENT = "plan-library:focus-search";

/** Gap kept between the dock and the bottom-right coordinate readout. */
const DOCK_GAP = 8;

export default function MissionPlannerPage() {
  const t = useTranslations("planner");
  const tToast = useTranslations("planner.toast");
  const { toast } = useToast();
  const router = useRouter();
  const p = usePlanner();
  const hasActivePlan = !!p.activePlanId;
  const isDownloading = p.downloadState === "downloading";
  // Send, download and fence/rally support all act on the selected, connected
  // vehicle; other connected drones that are not selected cannot receive them.
  const { supports, isConnected: hasDrone } = useFirmwareCapabilities();
  const { showGeofence, showRally } = planElementSupport(hasDrone, supports);

  const outlineOpen = usePlannerStore((s) => s.outlineOpen);
  const inspectorOpen = usePlannerStore((s) => s.inspectorOpen);
  // Phone-width window: outline and inspector float over the map as sheets.
  const narrow = useNarrowViewport();
  const dockOpen = usePlannerStore((s) => s.dockOpen);
  const librarySheetOpen = usePlannerStore((s) => s.librarySheetOpen);
  const inspectorIsMission = usePlannerStore((s) => s.inspectorTarget.kind === "mission");
  const selectedIds = usePlannerStore((s) => s.selectedWaypointIds);
  const mapBounds = usePlannerStore((s) => s.mapBounds);
  const mapZoom = usePlannerStore((s) => s.mapZoom);
  const mapTileSource = useSettingsStore((s) => s.mapTileSource);
  const mapView = usePlannerStore((s) => s.mapView);
  // The 3D view needs an open plan; Plans home always shows the 2D map.
  const is3d = hasActivePlan && mapView === "3d";
  const shareIo = usePlannerShareImport(p);

  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false);
  const [downloadPanelOpen, setDownloadPanelOpen] = useState(false);
  const sendDialog = usePlannerStore((s) => s.sendDialog);
  // Panel toggles from the keyboard snap; from the pointer they slide. The flag
  // is false only for the render that applies a keyboard toggle.
  const [panelAnimate, setPanelAnimate] = useState(true);

  // The overlay and download panels dock at the same spot, so they are mutually
  // exclusive — opening one closes the other. Both act on the 2D map only.
  const toggleOverlayPanel = useCallback(() => {
    if (usePlannerStore.getState().mapView === "3d") return;
    setOverlayPanelOpen((v) => !v);
    setDownloadPanelOpen(false);
  }, []);
  const toggleDownloadPanel = useCallback(() => {
    if (usePlannerStore.getState().mapView === "3d") return;
    setDownloadPanelOpen((v) => !v);
    setOverlayPanelOpen(false);
  }, []);
  // Entering 3D closes the 2D-only panels.
  useEffect(() => {
    if (!is3d) return;
    setOverlayPanelOpen(false);
    setDownloadPanelOpen(false);
  }, [is3d]);
  // Shapes are drawn on the 2D map: picking a drawing tool in 3D switches back.
  useEffect(() => {
    if (!is3d || !isDrawingTool(p.activeTool)) return;
    usePlannerStore.getState().setMapView("2d");
    toast(t("view3d.drawIn2d"), "info");
  }, [is3d, p.activeTool, toast, t]);
  const toggleView3d = useCallback(() => usePlannerStore.getState().toggleMapView(), []);
  // Keep every waypoint's terrain sample matched to its position while the
  // planner is open: any edit that moves a waypoint drops its old sample, and
  // the sync looks up the ground under the new spot.
  useEffect(() => startGroundElevationSync(), []);

  // A plan without a planned home gets one, and the home's ground is sampled.
  usePlannedHomeSeed();

  // Open a plan shared by link (#plan=...): saved to the library, opened when
  // nothing unsaved would be lost, and the fragment cleared.
  useSharedPlanLink(p.handlePlanLoaded);

  // Opening, creating or closing a plan always dismisses the library sheet and
  // returns the inspector to that plan's mission settings.
  const planIdRef = useRef(p.activePlanId);
  useEffect(() => {
    const s = usePlannerStore.getState();
    s.setLibrarySheetOpen(false);
    s.setInspectorTarget({ kind: "mission" });
    s.clearSelection();
    // Returning to the page keeps the plan's working state; only a switch to
    // another plan drops what belonged to the previous one.
    if (planIdRef.current === p.activePlanId) return;
    planIdRef.current = p.activePlanId;
    // Checklist ticks belong to the plan being prepared, never the next one.
    usePreflightChecklistStore.getState().clear();
    // A pattern drawn for the previous plan must not be applied to this one.
    const patterns = usePatternStore.getState();
    patterns.clear();
    patterns.clearAppliedBoundary();
  }, [p.activePlanId]);

  const togglePattern = useCallback(() => {
    const s = usePlannerStore.getState();
    s.setInspectorTarget(s.inspectorTarget.kind === "pattern" ? { kind: "mission" } : { kind: "pattern" });
    if (!s.inspectorOpen) s.toggleInspector();
  }, []);
  const openDock = useCallback((tab: DockTab) => usePlannerStore.getState().setDock(tab, true), []);
  const toggleAltitude = useCallback(() => usePlannerStore.getState().setDock("altitude"), []);
  const toggleIssues = useCallback(() => usePlannerStore.getState().setDock("issues"), []);
  const togglePlans = useCallback(() => {
    const s = usePlannerStore.getState();
    const opening = !hasActivePlan || !s.librarySheetOpen;
    if (hasActivePlan) s.setLibrarySheetOpen(opening);
    else {
      // A collapsed library has no search box to focus; expand it first.
      const lib = usePlanLibraryStore.getState();
      if (lib.libraryCollapsed) lib.toggleLibrary();
    }
    if (opening) requestAnimationFrame(() => document.dispatchEvent(new CustomEvent(FOCUS_LIBRARY_SEARCH_EVENT)));
  }, [hasActivePlan]);
  const transformMission = useCallback(() => {
    const s = usePlannerStore.getState();
    s.setInspectorTarget({ kind: "transform" });
    if (!s.inspectorOpen) s.toggleInspector();
  }, []);
  const simulate = useCallback(() => router.push("/simulate"), [router]);
  const openSend = useCallback(() => usePlannerStore.getState().openSendDialog(), []);
  const keyboardToggle = useCallback((toggle: () => void) => () => {
    setPanelAnimate(false);
    toggle();
    requestAnimationFrame(() => requestAnimationFrame(() => setPanelAnimate(true)));
  }, []);
  const { toggleOutline, toggleInspector, togglePanels, clearSelection } = usePlannerStore.getState();
  const keyToggles = useMemo(() => ({
    outline: keyboardToggle(toggleOutline),
    inspector: keyboardToggle(toggleInspector),
    panels: keyboardToggle(togglePanels),
  }), [keyboardToggle, toggleOutline, toggleInspector, togglePanels]);
  const resetInspector = useCallback(() => usePlannerStore.getState().setInspectorTarget({ kind: "mission" }), []);
  const closeLibrarySheet = useCallback(() => usePlannerStore.getState().setLibrarySheetOpen(false), []);
  const focusPlaceSearch = useCallback(() => document.dispatchEvent(new CustomEvent(FOCUS_PLACE_SEARCH_EVENT)), []);
  // One setWaypoints call is one undo step, as in the batch editor's delete.
  const removeWaypoints = useCallback((ids: string[]) => {
    const ms = useMissionStore.getState();
    ms.setWaypoints(ms.waypoints.filter((w) => !ids.includes(w.id)));
  }, []);
  // Arrow nudge and copy act on the whole multi-selection, else the single one.
  const selectedWaypointId = p.selectedWaypointId;
  const onNudgeSelected = useCallback((dLat: number, dLon: number) => {
    const ids = selectedIds.length >= 2 ? selectedIds : selectedWaypointId ? [selectedWaypointId] : [];
    if (ids.length === 0) return;
    const ms = useMissionStore.getState();
    ms.setWaypoints(nudgeWaypoints(ms.waypoints, ids, dLat, dLon));
  }, [selectedIds, selectedWaypointId]);
  const onCopy = useCallback(() => {
    const waypoints = useMissionStore.getState().waypoints;
    const picked = selectedIds.length >= 2
      ? waypoints.filter((w) => selectedIds.includes(w.id))
      : waypoints.filter((w) => w.id === selectedWaypointId);
    if (picked.length > 0) setClipboard(picked);
  }, [selectedIds, selectedWaypointId]);
  const onPaste = useCallback(() => {
    const clip = getClipboard();
    if (clip.length === 0) return;
    // Paste copies slightly offset so they are visible and selectable, with
    // jumps re-pointed at the pasted copies of their targets.
    const { waypoints: pasted, droppedJumps } = pasteWaypoints(clip);
    const ms = useMissionStore.getState();
    ms.setWaypoints([...ms.waypoints, ...pasted]);
    if (droppedJumps > 0) toast(tToast("pasteDroppedJumps", { count: droppedJumps }), "warning");
  }, [toast, tToast]);
  const onNoActivePlan = useCallback(() => toast(tToast("openPlanFirst"), "info"), [toast, tToast]);

  useKeyboardShortcuts({
    activeTool: p.activeTool, setActiveTool: p.setActiveTool, undo: p.undo, redo: p.redo,
    selectedWaypointId, removeWaypoint: p.removeWaypoint, removeWaypoints, setSelectedWaypoint: p.setSelectedWaypoint,
    selectedIds, clearSelection, inspectorIsMission, resetInspector,
    hasActivePlan, librarySheetOpen, onCloseLibrarySheet: closeLibrarySheet,
    handleSave: p.handleSave, handleSaveAs: p.handleSaveAs, handleNewPlan: p.handleNewPlan,
    onTogglePlans: togglePlans,
    onToggleOutline: keyToggles.outline,
    onToggleInspector: keyToggles.inspector,
    onTogglePanels: keyToggles.panels,
    onToggleTerrain: toggleAltitude, onTogglePatternEditor: togglePattern, onToggleValidation: toggleIssues,
    onToggleOverlays: toggleOverlayPanel,
    onFocusPlaceSearch: focusPlaceSearch,
    onToggleView3d: toggleView3d,
    onNudgeSelected, onCopy, onPaste, onNoActivePlan,
  });

  // Contribute planner verbs to the ⌘K command palette while this page is
  // mounted. The provider closes over the current handlers and re-registers if
  // any change (the planner handlers are memoized, so this normally runs once).
  const {
    setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
    handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
    handleDownloadFromDrone, handleExportNative, handleExportWaypoints, handleExportPlan,
    handleExportKML, handleExportKMZ, handleExportCSV, handleReverseWaypoints, handleClearAll,
  } = p;
  const { handleImportBoundary, handleExportBrief, handleCopyShareLink } = shareIo;
  const hasWaypoints = p.waypoints.length > 0;
  const { canSendSomething } = useSendable(p, showGeofence, showRally);
  useEffect(() => {
    const handlers: PlannerCommandHandlers = {
      setActiveTool: pSetActiveTool, undo: pUndo, redo: pRedo,
      handleSave: pHandleSave, handleSaveAs: pHandleSaveAs, handleNewPlan: pHandleNewPlan,
      toggleTerrain: toggleAltitude, togglePattern, toggleValidation: toggleIssues, toggleOverlays: toggleOverlayPanel,
      togglePlans, toggleOutline, toggleInspector, togglePanels, toggleView3d, openDock,
      sendToVehicle: openSend,
      downloadFromDrone: handleDownloadFromDrone, importBoundary: handleImportBoundary,
      exportNative: handleExportNative, exportWaypoints: handleExportWaypoints, exportPlan: handleExportPlan,
      exportKML: handleExportKML, exportKMZ: handleExportKMZ, exportCSV: handleExportCSV,
      exportBrief: handleExportBrief, copyShareLink: () => { void handleCopyShareLink(); },
      reverseWaypoints: handleReverseWaypoints, transformMission, simulate, discardPlan: handleClearAll,
      hasWaypoints, hasDrone, canSend: canSendSomething,
    };
    const category = t("paletteCategory");
    // Planner verbs act on an open plan; Plans home contributes none.
    return registerCommandProvider((ctx) =>
      ctx.pathname.startsWith("/plan") && hasActivePlan
        ? buildPlannerCommands(handlers, (k) => t(k), category, ctx.query)
        : [],
    );
  }, [
    pSetActiveTool, pUndo, pRedo, pHandleSave, pHandleSaveAs, pHandleNewPlan, toggleAltitude, togglePattern,
    toggleIssues, toggleOverlayPanel, togglePlans, toggleOutline, toggleInspector, togglePanels, toggleView3d, openDock, openSend,
    handleDownloadFromDrone, handleImportBoundary, handleExportNative, handleExportWaypoints, handleExportPlan,
    handleExportKML, handleExportKMZ, handleExportCSV, handleExportBrief, handleCopyShareLink,
    handleReverseWaypoints, transformMission, simulate, handleClearAll, t,
    hasActivePlan, hasDrone, hasWaypoints, canSendSomething,
  ]);

  const library = (presentation: "panel" | "sheet") => (
    <FlightPlanLibrary context="plan" presentation={presentation}
      onClose={() => usePlannerStore.getState().setLibrarySheetOpen(false)}
      onPlanLoaded={p.handlePlanLoaded} onSave={p.handleSave}
      onPlanRenamed={p.handlePlanRenamed} onDownloadFromDrone={p.handleDownloadFromDrone}
      isDownloading={isDownloading} hasDrone={hasDrone} />
  );
  const coordinateLift = DOCK_STRIP_HEIGHT + (dockOpen ? DOCK_DRAWER_HEIGHT : 0) + DOCK_GAP;

  return (
    <>
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        {hasActivePlan && (
          <PlannerBar p={p} hasDrone={hasDrone} showGeofence={showGeofence} showRally={showRally}
            shareIo={shareIo} onOpenSend={openSend} />
        )}
        <div className="relative flex-1 flex overflow-hidden">
          {hasActivePlan ? (
            <SidePanel side="left" open={outlineOpen} width={264} animate={panelAnimate} overlay={narrow} ariaLabel={t("outline.label")}>
              <PlanOutline p={p} showGeofence={showGeofence} showRally={showRally} />
            </SidePanel>
          ) : (
            library("panel")
          )}

          <div className="flex-1 relative min-w-0">
            <div className="absolute inset-x-0 top-0" style={{ bottom: hasActivePlan ? DOCK_STRIP_HEIGHT : 0 }}>
              {is3d ? (
                <Planner3DView waypoints={p.waypoints} activeTool={p.activeTool} selectedWaypointId={p.selectedWaypointId}
                  hasActivePlan={hasActivePlan} rallyPoints={p.rallyPoints} onMapClick={p.handleMapClick}
                  onMapRightClick={p.handleMapRightClick} onWaypointClick={p.handleWaypointClick}
                  onWaypointDragEnd={p.handleWaypointDragEnd} onWaypointRightClick={p.handleWaypointRightClick}
                  onDrawingComplete={p.handleDrawingComplete} />
              ) : (
                <PlannerMap waypoints={p.waypoints} activeTool={p.activeTool} selectedWaypointId={p.selectedWaypointId}
                  hasActivePlan={hasActivePlan} rallyPoints={p.rallyPoints} onMapClick={p.handleMapClick}
                  onMapRightClick={p.handleMapRightClick} onWaypointClick={p.handleWaypointClick}
                  onWaypointDragEnd={p.handleWaypointDragEnd} onWaypointRightClick={p.handleWaypointRightClick}
                  onDrawingComplete={p.handleDrawingComplete} />
              )}
            </div>
            {hasActivePlan && (
              <>
                <PlaceSearchBox />
                {!is3d && <CoordinateWidget bottomOffset={coordinateLift} />}
                <MapToolbar activeTool={p.activeTool} onToolChange={p.setActiveTool}
                  canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.undo} onRedo={p.redo}
                  onToggleOverlays={toggleOverlayPanel} overlayPanelOpen={overlayPanelOpen} overlaysDisabled={is3d}
                  onToggleDownload={toggleDownloadPanel} downloadPanelOpen={downloadPanelOpen} downloadDisabled={!mapBounds || is3d} />
                {overlayPanelOpen && !is3d && <OverlayPanel onClose={() => setOverlayPanelOpen(false)} />}
                {downloadPanelOpen && mapBounds && !is3d && (
                  <DownloadAreaPanel bounds={mapBounds} currentZoom={mapZoom} currentProvider={mapTileSource}
                    onClose={() => setDownloadPanelOpen(false)} />
                )}
                <PlannerDock p={p} />
                {librarySheetOpen && (
                  <div className="absolute left-0 top-0 bottom-0 flex" style={{ zIndex: MAP_OVERLAY_Z.popover }}>
                    {library("sheet")}
                  </div>
                )}
              </>
            )}
          </div>

          {hasActivePlan && (
            <SidePanel side="right" open={inspectorOpen} width={300} animate={panelAnimate} overlay={narrow} ariaLabel={t("inspector.label")}>
              <PlannerInspector p={p} showGeofence={showGeofence} showRally={showRally} />
            </SidePanel>
          )}
          {p.contextMenu && (
            <MapContextMenu x={p.contextMenu.x} y={p.contextMenu.y} items={p.contextMenu.items}
              onSelect={p.handleContextAction} onClose={() => p.setContextMenu(null)} />
          )}
        </div>
      </div>

      {shareIo.boundaryInput}
      <SendToVehicleDialog open={sendDialog !== null} onClose={() => usePlannerStore.getState().closeSendDialog()} p={p}
        showGeofence={showGeofence} showRally={showRally} resumeFromIndex={sendDialog?.resumeFromIndex} />
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
