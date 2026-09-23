/**
 * @module use-planner
 * @description Core hook for the mission planner page. Composes state,
 * actions, and IO sub-hooks into a single interface.
 * @license GPL-3.0-only
 */

export { type ContextMenuState } from "./use-planner-state";
import { usePlannerState } from "./use-planner-state";
import { usePlannerActions } from "./use-planner-actions";
import { usePlannerIO } from "./use-planner-io";

export function usePlanner() {
  const state = usePlannerState();

  const actions = usePlannerActions({
    waypoints: state.waypoints,
    activePlanId: state.activePlanId,
    isDirty: state.isDirty,
    activeTool: state.activeTool,
    defaultAlt: state.defaultAlt,
    defaultSpeed: state.defaultSpeed,
    defaultAcceptRadius: state.defaultAcceptRadius,
    selectedDroneId: state.selectedDroneId,
    missionName: state.missionName,
    contextMenu: state.contextMenu,
    addWaypoint: state.addWaypoint,
    removeWaypoint: state.removeWaypoint,
    insertWaypoint: state.insertWaypoint,
    clearMission: state.clearMission,
    setWaypoints: state.setWaypoints,
    downloadMission: state.downloadMission,
    uploadMission: state.uploadMission,
    addRallyPoint: state.addRallyPoint,
    setContextMenu: state.setContextMenu,
    setSelectedWaypoint: state.setSelectedWaypoint,
    setExpandedWaypoint: state.setExpandedWaypoint,
    setShowClearConfirm: state.setShowClearConfirm,
    setShowPatternApplyConfirm: state.setShowPatternApplyConfirm,
    setShowDownloadConfirm: state.setShowDownloadConfirm,
    setMissionName: state.setMissionName,
    setSelectedDroneId: state.setSelectedDroneId,
    toast: state.toast,
  });

  const io = usePlannerIO({
    waypoints: state.waypoints,
    missionName: state.missionName,
    selectedDroneId: state.selectedDroneId,
    activePlanId: state.activePlanId,
    isDirty: state.isDirty,
    libAutoSaveTimer: state.libAutoSaveTimer,
    setWaypoints: state.setWaypoints,
    setMissionName: state.setMissionName,
    setSelectedDroneId: state.setSelectedDroneId,
    setSelectedWaypoint: state.setSelectedWaypoint,
    setExpandedWaypoint: state.setExpandedWaypoint,
    setShowDownloadConfirm: state.setShowDownloadConfirm,
    downloadMission: state.downloadMission,
    toast: state.toast,
  });

  return {
    // Store state
    waypoints: state.waypoints,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    uploadState: state.uploadState,
    downloadState: state.downloadState,
    activeTool: state.activeTool,
    setActiveTool: state.setActiveTool,
    panelCollapsed: state.panelCollapsed,
    togglePanel: state.togglePanel,
    altProfileCollapsed: state.altProfileCollapsed,
    toggleAltProfile: state.toggleAltProfile,
    expandedWaypointId: state.expandedWaypointId,
    setExpandedWaypoint: state.setExpandedWaypoint,
    selectedWaypointId: state.selectedWaypointId,
    setSelectedWaypoint: state.setSelectedWaypoint,
    defaultAlt: state.defaultAlt,
    defaultSpeed: state.defaultSpeed,
    defaultAcceptRadius: state.defaultAcceptRadius,
    defaultFrame: state.defaultFrame,
    setDefaults: state.setDefaults,
    drones: state.drones,

    // Mission setup
    missionName: state.missionName,
    setMissionName: state.setMissionName,
    selectedDroneId: state.selectedDroneId,
    setSelectedDroneId: state.setSelectedDroneId,

    // Context menu
    contextMenu: state.contextMenu,
    setContextMenu: state.setContextMenu,
    showClearConfirm: state.showClearConfirm,
    setShowClearConfirm: state.setShowClearConfirm,
    showPatternApplyConfirm: state.showPatternApplyConfirm,
    setShowPatternApplyConfirm: state.setShowPatternApplyConfirm,
    showDownloadConfirm: state.showDownloadConfirm,

    // Library integration
    isDirty: state.isDirty,
    activePlanId: state.activePlanId,

    // Handlers from actions
    ...actions,

    // Handlers from IO
    ...io,

    // Drawing state
    drawingMode: state.drawingMode,
    drawnPolygons: state.drawnPolygons,
    drawnCircles: state.drawnCircles,
    measureLine: state.measureLine,
    clearDrawings: state.clearDrawings,

    // Rally points
    rallyPoints: state.rallyPoints,

    // Store actions passed through
    undo: state.undo,
    redo: state.redo,
    updateWaypoint: state.updateWaypoint,
    removeWaypoint: state.removeWaypoint,
    reorderWaypoints: state.reorderWaypoints,
  };
}
