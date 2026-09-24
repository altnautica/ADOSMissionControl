/**
 * @module use-planner-state
 * @description State interface and initial hook setup for the mission planner.
 * @license GPL-3.0-only
 */

import { useState, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { useMissionStore } from "@/stores/mission-store";
import { usePlannerStore } from "@/stores/planner-store";
import { useFleetStore } from "@/stores/fleet-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { useToast } from "@/components/ui/toast";
import { useDrawingStore } from "@/stores/drawing-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlannerHistoryStore } from "@/stores/planner-history-store";
import type { ContextMenuItem } from "@/components/planner/MapContextMenu";

export interface ContextMenuState {
  x: number;
  y: number;
  items: ContextMenuItem[];
  lat?: number;
  lon?: number;
  waypointId?: string;
}

/** Clamp a latitude to [-90, 90]. */
export function clampLat(lat: number): number {
  return Math.max(-90, Math.min(90, lat));
}

/** Clamp a longitude to [-180, 180]. */
export function clampLon(lon: number): number {
  return Math.max(-180, Math.min(180, lon));
}

/** Clamp altitude to >= 0. */
export function clampAlt(alt: number): number {
  return Math.max(0, alt);
}

/** Set up all store connections and local state for the planner hook. */
export function usePlannerState() {
  // Both stores are selected field by field: they also carry per-map-move view
  // state, upload receipts and warnings, and a whole-store subscription
  // re-rendered the whole planner tree on every one of those writes.
  const {
    waypoints, addWaypoint, removeWaypoint, updateWaypoint, insertWaypoint,
    reorderWaypoints, uploadMission, downloadMission, uploadState, downloadState,
    undo, redo, clearMission, setWaypoints,
  } = useMissionStore(
    useShallow((s) => ({
      waypoints: s.waypoints,
      addWaypoint: s.addWaypoint,
      removeWaypoint: s.removeWaypoint,
      updateWaypoint: s.updateWaypoint,
      insertWaypoint: s.insertWaypoint,
      reorderWaypoints: s.reorderWaypoints,
      uploadMission: s.uploadMission,
      downloadMission: s.downloadMission,
      uploadState: s.uploadState,
      downloadState: s.downloadState,
      undo: s.undo,
      redo: s.redo,
      clearMission: s.clearMission,
      setWaypoints: s.setWaypoints,
    })),
  );
  // Selected field by field on purpose. The history store republishes on every
  // timeline event, so a whole-store subscription re-rendered the planner on
  // each edit to deliver two flags that only flip at the ends of the timeline.
  const canUndo = usePlannerHistoryStore((s) => s.canUndo);
  const canRedo = usePlannerHistoryStore((s) => s.canRedo);

  const {
    activeTool, setActiveTool,
    panelCollapsed, togglePanel,
    altProfileCollapsed, toggleAltProfile,
    expandedWaypointId, setExpandedWaypoint,
    selectedWaypointId, setSelectedWaypoint,
    defaultAlt, defaultSpeed, defaultAcceptRadius, defaultFrame,
    setDefaults,
  } = usePlannerStore(
    useShallow((s) => ({
      activeTool: s.activeTool,
      setActiveTool: s.setActiveTool,
      panelCollapsed: s.panelCollapsed,
      togglePanel: s.togglePanel,
      altProfileCollapsed: s.altProfileCollapsed,
      toggleAltProfile: s.toggleAltProfile,
      expandedWaypointId: s.expandedWaypointId,
      setExpandedWaypoint: s.setExpandedWaypoint,
      selectedWaypointId: s.selectedWaypointId,
      setSelectedWaypoint: s.setSelectedWaypoint,
      defaultAlt: s.defaultAlt,
      defaultSpeed: s.defaultSpeed,
      defaultAcceptRadius: s.defaultAcceptRadius,
      defaultFrame: s.defaultFrame,
      setDefaults: s.setDefaults,
    })),
  );

  const drones = useFleetStore((s) => s.drones);
  const { toast } = useToast();

  // Mission setup state
  const [missionName, setMissionName] = useState("");
  const [selectedDroneId, setSelectedDroneId] = useState("");

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  // Clear confirm
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Pattern-apply confirm (destructive: replaces every waypoint)
  const [showPatternApplyConfirm, setShowPatternApplyConfirm] = useState(false);

  // Download from drone confirm (unsaved changes)
  const [showDownloadConfirm, setShowDownloadConfirm] = useState(false);

  // Plan library integration
  const activePlanId = usePlanLibraryStore((s) => s.activePlanId);
  const isDirty = usePlanLibraryStore((s) => s.isDirty);

  // Rally point state
  const rallyPoints = useRallyStore((s) => s.points);
  const addRallyPoint = useRallyStore((s) => s.addPoint);

  // Drawing store
  const drawingMode = useDrawingStore((s) => s.drawingMode);
  const drawnPolygons = useDrawingStore((s) => s.polygons);
  const drawnCircles = useDrawingStore((s) => s.circles);
  const measureLine = useDrawingStore((s) => s.measureLine);
  const clearDrawings = useDrawingStore((s) => s.clearAll);

  // Library auto-save timer ref
  const libAutoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  return {
    // Mission store
    waypoints, addWaypoint, removeWaypoint, updateWaypoint, insertWaypoint,
    reorderWaypoints, uploadMission, downloadMission, uploadState, downloadState,
    canUndo, canRedo, undo, redo, clearMission, setWaypoints,
    // Planner store
    activeTool, setActiveTool,
    panelCollapsed, togglePanel,
    altProfileCollapsed, toggleAltProfile,
    expandedWaypointId, setExpandedWaypoint,
    selectedWaypointId, setSelectedWaypoint,
    defaultAlt, defaultSpeed, defaultAcceptRadius, defaultFrame, setDefaults,
    // Fleet
    drones, toast,
    // Local state
    missionName, setMissionName,
    selectedDroneId, setSelectedDroneId,
    contextMenu, setContextMenu,
    showClearConfirm, setShowClearConfirm,
    showPatternApplyConfirm, setShowPatternApplyConfirm,
    showDownloadConfirm, setShowDownloadConfirm,
    activePlanId, isDirty,
    rallyPoints, addRallyPoint,
    drawingMode, drawnPolygons, drawnCircles, measureLine, clearDrawings,
    libAutoSaveTimer,
  };
}
