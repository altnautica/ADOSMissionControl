/**
 * @module planner-store
 * @description Zustand store for mission planner UI state.
 * Manages active tool selection, the side panels, dock and inspector target,
 * waypoint selection, the last map view, and default values for new waypoints
 * (altitude, speed, accept radius, frame).
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { PlannerTool, AltitudeFrame } from "@/lib/types/mission";
import { indexedDBStorage } from "@/lib/storage";
import { PLANNER_STORE_KEY } from "@/lib/mission/mission-frame";
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
import { DEFAULT_ZOOM_UNLOCATED } from "@/lib/map-constants";
import { isNarrowViewport } from "@/hooks/use-narrow-viewport";

/** Dock tabs, in display order. */
export const DOCK_TABS = ["altitude", "terrain", "issues", "energy", "site", "checklist"] as const;
export type DockTab = (typeof DOCK_TABS)[number];

/**
 * What the inspector shows when no waypoint is selected. A waypoint selection
 * (one → Waypoint, several → Batch) always wins over this; it is what the
 * outline, a shortcut or a menu item last pointed the inspector at.
 */
export type InspectorTarget =
  | { kind: "mission" }
  | { kind: "pattern" }
  | { kind: "geofence" }
  | { kind: "rally"; id: string | null }
  | { kind: "poi"; id: string | null }
  | { kind: "transform" };

const MISSION_TARGET: InspectorTarget = { kind: "mission" };

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
  /** Whether the right-side inspector is open. Closed hides it without unmounting. */
  inspectorOpen: boolean;
  /** Whether the left-side plan outline is open. */
  outlineOpen: boolean;
  /** Whether the bottom dock drawer is expanded (collapsed shows the stats strip). */
  dockOpen: boolean;
  /** The dock tab shown when the drawer is expanded. */
  dockTab: DockTab;
  /** What the inspector edits when no waypoint is selected. */
  inspectorTarget: InspectorTarget;
  /** Open state of persisted collapsible inspector sections, by key. */
  sectionOpen: Record<string, boolean>;
  /** Whether the plan library sheet is shown over the map while a plan is open. */
  librarySheetOpen: boolean;
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
  /**
   * Default waypoint acceptance radius (m). 0 leaves it to the flight
   * controller: ArduPlane then turns early by its WP_RADIUS turn distance,
   * which any fixed radius disables.
   */
  defaultAcceptRadius: number;
  /** Default altitude reference frame. */
  defaultFrame: AltitudeFrame;
  /** Timestamp of the last fit-bounds request (0 = none). PlannerMap watches this. */
  fitRequestTs: number;
  /** Pan-to-point request (null = none). PlannerMap watches this and recenters. */
  panRequest: { lat: number; lon: number; ts: number } | null;
  /** Current map center for features that need map position (e.g. Quick Rect). */
  mapCenter: [number, number];
  /** Current map viewport bounds (null until the map first reports them). */
  mapBounds: { north: number; south: number; east: number; west: number } | null;
  /** Current map zoom level. */
  mapZoom: number;
  /** Whether the planner shows the 2D map or the 3D view. Persisted. */
  mapView: "2d" | "3d";
  setMapView: (view: "2d" | "3d") => void;
  toggleMapView: () => void;
  /**
   * The Send-to-vehicle dialog, when open. `resumeFromIndex` opens it in
   * resume mode: the mission row uploads the mission that picks the plan up
   * at that planner waypoint index. Not persisted.
   */
  sendDialog: { resumeFromIndex?: number } | null;
  /** Open the Send-to-vehicle dialog, in resume mode with `resumeFromIndex`. */
  openSendDialog: (opts?: { resumeFromIndex?: number }) => void;
  closeSendDialog: () => void;
  /**
   * One-shot planned-home placement: the next map click sets the planned home
   * and disarms. Transient, never persisted.
   */
  homePickArmed: boolean;
  setHomePickArmed: (armed: boolean) => void;
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
  toggleInspector: () => void;
  toggleOutline: () => void;
  /** Toggle both side panels together: closes both when either is open. */
  togglePanels: () => void;
  /**
   * Show the dock on `tab`. With `open` omitted, a second call on the tab that
   * is already showing collapses the drawer (the T / I shortcut behaviour).
   */
  setDock: (tab: DockTab, open?: boolean) => void;
  /** Point the inspector at a target. Any non-mission target clears the waypoint selection. */
  setInspectorTarget: (target: InspectorTarget) => void;
  setSectionOpen: (key: string, open: boolean) => void;
  setLibrarySheetOpen: (open: boolean) => void;
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
  /** Clear both the single and the multi selection. */
  clearSelection: () => void;
  /** Update current map center. */
  setMapCenter: (center: [number, number]) => void;
  /** Update current map viewport bounds + zoom (from move/zoom events). */
  setMapViewport: (bounds: { north: number; south: number; east: number; west: number }, zoom: number) => void;
}

let plannerHydrationDone = false;
const plannerHydrationListeners = new Set<() => void>();

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
  // On a phone-width window the inspector is a sheet over the map, so it
  // starts closed there.
  inspectorOpen: !isNarrowViewport(),
  outlineOpen: typeof window !== "undefined" && window.innerWidth >= 1280,
  dockOpen: false,
  dockTab: "altitude",
  inspectorTarget: MISSION_TARGET,
  sectionOpen: {},
  librarySheetOpen: false,
  selectedWaypointId: null,
  selectedWaypointIds: [],
  selectionMode: "single",
  defaultAlt: 50,
  defaultSpeed: 5,
  defaultAcceptRadius: 0,
  defaultFrame: "relative",
  fitRequestTs: 0,
  panRequest: null,
  mapCenter: [0, 0],
  mapBounds: null,
  mapZoom: DEFAULT_ZOOM_UNLOCATED,
  mapView: "2d",
  sendDialog: null,
  homePickArmed: false,

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
  toggleInspector: () => set((s) => ({ inspectorOpen: !s.inspectorOpen })),
  toggleOutline: () => set((s) => ({ outlineOpen: !s.outlineOpen })),
  togglePanels: () =>
    set((s) => {
      const open = !(s.inspectorOpen || s.outlineOpen);
      return { inspectorOpen: open, outlineOpen: open };
    }),
  setDock: (dockTab, open) =>
    set((s) => ({
      dockTab,
      dockOpen: open ?? !(s.dockOpen && s.dockTab === dockTab),
    })),
  setInspectorTarget: (inspectorTarget) =>
    set(
      inspectorTarget.kind === "mission"
        ? { inspectorTarget }
        : { inspectorTarget, selectedWaypointId: null, selectedWaypointIds: [], selectionMode: "single" },
    ),
  setSectionOpen: (key, open) => set((s) => ({ sectionOpen: { ...s.sectionOpen, [key]: open } })),
  setLibrarySheetOpen: (librarySheetOpen) => set({ librarySheetOpen }),
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
  clearSelection: () => set({ selectedWaypointId: null, selectedWaypointIds: [], selectionMode: "single" }),
  setMapCenter: (mapCenter) => set({ mapCenter }),
  setMapViewport: (mapBounds, mapZoom) => set({ mapBounds, mapZoom }),
  setMapView: (mapView) => set({ mapView }),
  toggleMapView: () => set((s) => ({ mapView: s.mapView === "3d" ? "2d" : "3d" })),
  openSendDialog: (opts) =>
    set({ sendDialog: opts?.resumeFromIndex !== undefined ? { resumeFromIndex: opts.resumeFromIndex } : {} }),
  closeSendDialog: () => set({ sendDialog: null }),
  setHomePickArmed: (homePickArmed) => set({ homePickArmed }),
  };
  return state;
    },
    {
      name: PLANNER_STORE_KEY,
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 4,
      partialize: (state) => ({
        defaultAlt: state.defaultAlt,
        defaultSpeed: state.defaultSpeed,
        defaultAcceptRadius: state.defaultAcceptRadius,
        defaultFrame: state.defaultFrame,
        // The last map view, so the planner reopens where the operator left it.
        mapCenter: state.mapCenter,
        mapZoom: state.mapZoom,
        // Panel layout: which side panels and dock are open, and which
        // collapsible inspector sections the operator left open.
        inspectorOpen: state.inspectorOpen,
        outlineOpen: state.outlineOpen,
        dockOpen: state.dockOpen,
        dockTab: state.dockTab,
        sectionOpen: state.sectionOpen,
        mapView: state.mapView,
      }),
      // Fires on success and on a failed read (zustand leaves `hasHydrated()`
      // false when the storage read rejects), so the planner never waits
      // forever on persisted state that is not coming; the defaults stand.
      onRehydrateStorage: () => () => {
        plannerHydrationDone = true;
        plannerHydrationListeners.forEach((cb) => cb());
      },
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
        // v3 added the persisted map view and panel layout. Older payloads
        // simply lack them, so the store defaults fill in: the map opens
        // unlocated or at the GPS fix, and the panels take their defaults.
        if (version < 4 && state.mapView === undefined) {
          // v4 persists the 2D/3D view choice; older payloads open in 2D.
          state.mapView = "2d";
        }
        return state as Partial<PlannerStoreState>;
      },
    }
  )
);

/** Persisted planner state has loaded, or the load failed and the defaults stand. */
export function plannerHydrationSettled(): boolean {
  return plannerHydrationDone || usePlannerStore.persist.hasHydrated();
}

/** Subscribe to {@link plannerHydrationSettled} turning true; returns the unsubscribe. */
export function onPlannerHydrationSettled(cb: () => void): () => void {
  plannerHydrationListeners.add(cb);
  return () => {
    plannerHydrationListeners.delete(cb);
  };
}
