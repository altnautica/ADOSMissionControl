/**
 * @module planner-store
 * @description Zustand store for mission planner UI state.
 * Manages active tool selection, panel visibility, waypoint selection/expansion,
 * and default values for new waypoints (altitude, speed, accept radius, frame).
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlannerTool, AltitudeFrame } from "@/lib/types";
import { indexedDBStorage } from "@/lib/storage";

interface PlannerStoreState {
  /** Currently selected map tool (select, waypoint, polygon, circle, measure). */
  activeTool: PlannerTool;
  /** Whether the right-side mission panel is collapsed. */
  panelCollapsed: boolean;
  /** Whether the altitude profile chart is collapsed. */
  altProfileCollapsed: boolean;
  /** ID of the waypoint whose inline editor is expanded, or null. */
  expandedWaypointId: string | null;
  /** ID of the currently selected waypoint, or null. */
  selectedWaypointId: string | null;
  /** IDs of waypoints selected for batch editing. */
  selectedWaypointIds: string[];
  /** Selection mode for waypoint clicks. */
  selectionMode: "single" | "multi";
  /** Default altitude (m AGL) for new waypoints. */
  defaultAlt: number;
  /** Default speed (m/s) for new waypoints. */
  defaultSpeed: number;
  /** Default waypoint acceptance radius (m). */
  defaultAcceptRadius: number;
  /** Default altitude reference frame. */
  defaultFrame: AltitudeFrame;
  /** Timestamp of the last fit-bounds request (0 = none). PlannerMap watches this. */
  fitRequestTs: number;
  /** Whether the pattern editor section is open in the right panel. */
  patternSectionOpen: boolean;
  setActiveTool: (tool: PlannerTool) => void;
  togglePanel: () => void;
  toggleAltProfile: () => void;
  setExpandedWaypoint: (id: string | null) => void;
  setSelectedWaypoint: (id: string | null) => void;
  /** Toggle a waypoint in multi-selection (Ctrl+click). */
  toggleWaypointSelection: (id: string) => void;
  /** Select a range of waypoints between two IDs (Shift+click). Requires waypointIds array. */
  selectRange: (fromId: string, toId: string, waypointIds: string[]) => void;
  /** Clear multi-selection. */
  clearMultiSelection: () => void;
  setDefaults: (defaults: Partial<Pick<PlannerStoreState, "defaultAlt" | "defaultSpeed" | "defaultAcceptRadius" | "defaultFrame">>) => void;
  /** Request map to fit bounds to current waypoints. */
  requestFit: () => void;
  /** Reset fit request after map has processed it. */
  clearFitRequest: () => void;
  /** Set pattern section open/closed. */
  setPatternSectionOpen: (open: boolean) => void;
}

export const usePlannerStore = create<PlannerStoreState>()(
  persist(
    (set) => ({
  activeTool: "select",
  panelCollapsed: false,
  altProfileCollapsed: true,
  expandedWaypointId: null,
  selectedWaypointId: null,
  selectedWaypointIds: [],
  selectionMode: "single",
  defaultAlt: 50,
  defaultSpeed: 5,
  defaultAcceptRadius: 2,
  defaultFrame: "relative",
  fitRequestTs: 0,
  patternSectionOpen: false,

  setActiveTool: (activeTool) => set({ activeTool }),
  togglePanel: () => set((s) => ({ panelCollapsed: !s.panelCollapsed })),
  toggleAltProfile: () => set((s) => ({ altProfileCollapsed: !s.altProfileCollapsed })),
  setExpandedWaypoint: (expandedWaypointId) => set({ expandedWaypointId }),
  setSelectedWaypoint: (selectedWaypointId) => set({ selectedWaypointId }),
  toggleWaypointSelection: (id) =>
    set((s) => {
      const ids = s.selectedWaypointIds.includes(id)
        ? s.selectedWaypointIds.filter((x) => x !== id)
        : [...s.selectedWaypointIds, id];
      return { selectedWaypointIds: ids, selectionMode: ids.length > 0 ? "multi" : "single" };
    }),
  selectRange: (fromId, toId, waypointIds) =>
    set(() => {
      const fromIdx = waypointIds.indexOf(fromId);
      const toIdx = waypointIds.indexOf(toId);
      if (fromIdx === -1 || toIdx === -1) return {};
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      const rangeIds = waypointIds.slice(start, end + 1);
      return { selectedWaypointIds: rangeIds, selectionMode: "multi" };
    }),
  clearMultiSelection: () =>
    set({ selectedWaypointIds: [], selectionMode: "single" }),
  setDefaults: (defaults) => set((s) => ({ ...s, ...defaults })),
  requestFit: () => set({ fitRequestTs: Date.now() }),
  clearFitRequest: () => set({ fitRequestTs: 0 }),
  setPatternSectionOpen: (patternSectionOpen) => set({ patternSectionOpen }),
    }),
    {
      name: "altcmd:planner-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 1,
      partialize: (state) => ({
        defaultAlt: state.defaultAlt,
        defaultSpeed: state.defaultSpeed,
        defaultAcceptRadius: state.defaultAcceptRadius,
        defaultFrame: state.defaultFrame,
      }),
    }
  )
);
