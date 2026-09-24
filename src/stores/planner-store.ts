/**
 * @module planner-store
 * @description Zustand store for mission planner UI state.
 * Manages active tool selection, panel visibility, waypoint selection/expansion,
 * and default values for new waypoints (altitude, speed, accept radius, frame).
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlannerTool, AltitudeFrame } from "@/lib/types/mission";
import { indexedDBStorage } from "@/lib/storage";
import {
  type PlannerMode,
  type DatumPattern,
  DEFAULT_PLANNER_MODE,
  transition,
  toolForMode,
  drawingModeFor,
} from "@/lib/planner-mode";
import { useDrawingStore } from "./drawing-store";
import { usePatternStore } from "./pattern-store";

interface PlannerStoreState {
  /**
   * Authoritative interaction mode. Every map gesture (placement, drawing,
   * datum, rally, select) is derived from this single value, and `activeTool`
   * plus the transient drawing sub-mode are kept in sync from here so switching
   * the tool can never leave a stale drawing sub-mode behind.
   */
  mode: PlannerMode;
  /**
   * Currently selected map tool. Derived from {@link mode} and kept in sync on
   * every transition so existing consumers can keep reading it unchanged.
   */
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
  /** Pan-to-point request (null = none). PlannerMap watches this and recenters. */
  panRequest: { lat: number; lon: number; ts: number } | null;
  /** Whether the pattern editor section is open in the right panel. */
  patternSectionOpen: boolean;
  /** Current map center for features that need map position (e.g. Quick Rect). */
  mapCenter: [number, number];
  /** Current map viewport bounds (null until the map first reports them). */
  mapBounds: { north: number; south: number; east: number; west: number } | null;
  /** Current map zoom level. */
  mapZoom: number;
  /**
   * Set the active tool. Routes through the planner-mode reducer so the new
   * mode carries no residue of the previous sub-mode, and mirrors the transient
   * drawing sub-mode for the new tool.
   */
  setActiveTool: (tool: PlannerTool) => void;
  /**
   * Replace the interaction mode directly (e.g. to arm a datum for a specific
   * pattern or start a tagged draw). Keeps `activeTool` and the drawing
   * sub-mode in sync, same as a tool switch.
   */
  setMode: (mode: PlannerMode) => void;
  /**
   * Arm datum placement for a specific search pattern, so the next map click
   * writes the origin into that pattern's config. The armed pattern rides on the
   * mode itself (not read from a sibling store at click time).
   */
  armDatum: (pattern: DatumPattern) => void;
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
  /** Request the map to recenter on a point. */
  requestPan: (lat: number, lon: number) => void;
  /** Reset pan request after the map has processed it. */
  clearPanRequest: () => void;
  /** Set pattern section open/closed. */
  setPatternSectionOpen: (open: boolean) => void;
  /** Update current map center. */
  setMapCenter: (center: [number, number]) => void;
  /** Update current map viewport bounds + zoom (from move/zoom events). */
  setMapView: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}

export const usePlannerStore = create<PlannerStoreState>()(
  persist<PlannerStoreState, [], [], Partial<PlannerStoreState>>(
    (set) => {
  /**
   * Commit a new interaction mode: derive `activeTool`, mirror the transient
   * drawing-tool sub-mode (null for a non-draw mode), and drop a stale armed
   * flight pattern when the operator moves on to placing a different kind of
   * point. The pattern-boundary flow draws its polygon with the draw tool, sets
   * its origin with the datum tool, and rests in select while the pattern stays
   * armed, so the pattern is KEPT across the draw / datum / select tools; it is
   * cleared only when switching to plain waypoint or rally placement, which
   * abandons the pattern (and stops a later free-hand draw from being captured by
   * it). Drawn geometry is never cleared here — that stays an explicit action.
   */
  const applyMode = (mode: PlannerMode) => {
    set({ mode, activeTool: toolForMode(mode) });
    const nextDrawingMode = drawingModeFor(mode);
    if (useDrawingStore.getState().drawingMode !== nextDrawingMode) {
      useDrawingStore.getState().setDrawingMode(nextDrawingMode);
    }
    if (
      (mode.kind === "waypoint" || mode.kind === "rally" || mode.kind === "poi") &&
      usePatternStore.getState().activePatternType !== null
    ) {
      // Clear only the armed type, leaving drawn shapes and pattern config alone.
      usePatternStore.setState({ activePatternType: null });
    }
  };
  const state: PlannerStoreState = {
  mode: DEFAULT_PLANNER_MODE,
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
  panRequest: null,
  patternSectionOpen: false,
  mapCenter: [0, 0],
  mapBounds: null,
  mapZoom: 13,

  setActiveTool: (tool) => {
    const mode = usePlannerStore.getState().mode;
    if (tool === "datum") {
      // Arming datum from a generic entry point (keyboard / toolbar) captures the
      // currently-armed search pattern onto the mode, so the map click reads the
      // authoritative mode rather than a sibling store. fixedWing/vtol landing are
      // not datum patterns, so they arm datum with no pattern.
      const active = usePatternStore.getState().activePatternType;
      const pattern: DatumPattern = active === "fixedWingLanding" || active === "vtolLanding" ? null : active;
      applyMode(transition(mode, { type: "armDatum", pattern }));
      return;
    }
    applyMode(transition(mode, { type: "selectTool", tool }));
  },
  setMode: (mode) => applyMode(mode),
  armDatum: (pattern) => applyMode(transition(usePlannerStore.getState().mode, { type: "armDatum", pattern })),
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
  requestPan: (lat, lon) => set({ panRequest: { lat, lon, ts: Date.now() } }),
  clearPanRequest: () => set({ panRequest: null }),
  setPatternSectionOpen: (patternSectionOpen) => set({ patternSectionOpen }),
  setMapCenter: (mapCenter) => set({ mapCenter }),
  setMapView: (mapBounds, mapZoom) => set({ mapBounds, mapZoom }),
  };
  return state;
    },
    {
      name: "altcmd:planner-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 2,
      partialize: (state) => ({
        defaultAlt: state.defaultAlt,
        defaultSpeed: state.defaultSpeed,
        defaultAcceptRadius: state.defaultAcceptRadius,
        defaultFrame: state.defaultFrame,
      }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // v2: the interaction mode became the single source of truth. The
          // persisted payload only ever carried the four `default*` values, so
          // a stale payload has no `mode`. Seed the idle default; `mode` is
          // transient and excluded from `partialize`, so it is never persisted
          // going forward (this branch only matters for the one-time read of an
          // older payload). The persisted defaults are preserved untouched.
          state.mode = DEFAULT_PLANNER_MODE;
        }
        return state as Partial<PlannerStoreState>;
      },
    }
  )
);
