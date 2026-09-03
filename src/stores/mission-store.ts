/**
 * @module mission-store
 * @description Zustand store for mission waypoint state and mission
 * upload/download via the drone protocol abstraction.
 *
 * Undo/redo is no longer waypoint-local. Every operator mutation records ONE
 * combined snapshot into the coordinated planner history (`planner-history`),
 * which spans waypoints, the geofence, rally points, and drawn shapes, so a
 * single Ctrl+Z reverts the last planner action regardless of which domain it
 * touched. This store registers the waypoint half of that snapshot at module
 * init and routes its own ``undo()`` / ``redo()`` entry points (still used by the
 * keyboard dispatcher) through the shared timeline.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Mission, Waypoint, MissionState } from "@/lib/types";
import type { MissionItem } from "@/lib/protocol/types";
import { useDroneManager } from "./drone-manager";
import { usePlannerStore } from "./planner-store";
import { indexedDBStorage } from "@/lib/storage";
import {
  recordHistory,
  undoHistory,
  redoHistory,
  clearHistory,
} from "@/lib/planner-history";
// Import the adapter registration from the dependency-free leaf module directly,
// not via the planner-history re-export: mission-store sits on an import cycle
// with planner-history (planner-history → leaf stores → drone-manager → … →
// mission-store), so a re-exported binding can still be unpopulated when this
// module's top-level registration runs mid-cycle. The leaf module imports
// nothing, so its bindings are always ready.
import { registerWaypointAdapter } from "@/lib/planner-history-adapter";
// The pure mission ⇄ wire expander/collapser: the single source of truth for how
// the waypoint model (with attached actions) maps onto the MAVLink mission wire
// format on upload/download, and how a legacy flat plan folds into it.
import {
  expandToItems,
  collapseFromItems,
  foldLegacyWaypoints,
} from "@/lib/mission/mission-expand";

/**
 * The execution half of a {@link Mission}, reset to "not running".
 *
 * A persisted mission is a plan. Anything describing what the vehicle is
 * currently doing has to be re-derived from live telemetry, never restored, so
 * these fields are neutralised both on the way out (`partialize`) and on the
 * way in for a payload written before that rule existed (`migrate` v4).
 */
const IDLE_EXECUTION = {
  state: "planning",
  progress: 0,
  currentWaypoint: 0,
  startedAt: undefined,
  completedAt: undefined,
} as const satisfies Partial<Mission>;

/** The subset of mission state written to IndexedDB. */
export interface PersistedMissionState {
  waypoints: Waypoint[];
  activeMission: Mission | null;
}

/**
 * Select what persists.
 *
 * The PLAN half of the mission persists; the EXECUTION half does not.
 * `Mission` carries `state` / `progress` / `currentWaypoint` / `startedAt`
 * alongside the plan, and persisting them verbatim meant a reload with
 * `state: "running"` put `MissionExecutionOverlay` and `OverviewMap`'s mission
 * controls on screen for a mission that is not running, with nothing
 * connected — while the top-level `progress` and `currentWaypoint` (correctly
 * not persisted) read 0. Two surfaces, two answers. `flight-lifecycle` would
 * also stamp the stale mission id and name onto the next flight's record.
 *
 * Exported so the shape is testable without driving the persist middleware.
 */
export function missionPartialize(
  state: MissionStoreState,
): PersistedMissionState {
  return {
    waypoints: state.waypoints,
    activeMission: state.activeMission
      ? { ...state.activeMission, ...IDLE_EXECUTION }
      : null,
  };
}

/**
 * Migrate a persisted mission payload forward. Exported so each branch is
 * unit-testable in isolation.
 */
export function migrateMissionStore(
  persisted: unknown,
  version: number,
): MissionStoreState {
  const state = persisted as Record<string, unknown>;
  if (version < 2) {
    // v2 retired the suite framework. Strip the dropped ``suiteType`` field off
    // ``activeMission`` so the persisted shape matches the TypeScript
    // interface verbatim rather than relying on excess-property tolerance.
    const active = state.activeMission as Record<string, unknown> | null;
    if (active && "suiteType" in active) {
      delete active.suiteType;
      state.activeMission = active;
    }
  }
  if (version < 3) {
    // v3 nests action commands (DO_/CONDITION_) under the navigation waypoint
    // they fire at. Fold a legacy flat list, where actions were their own
    // top-level rows, into the per-waypoint ``actions[]`` model.
    if (Array.isArray(state.waypoints)) {
      state.waypoints = foldLegacyWaypoints(state.waypoints as Waypoint[]);
    }
  }
  if (version < 4) {
    // v4 stopped persisting live mission-execution state. A payload written by
    // v3 or earlier can still name a running mission, so reset the execution
    // fields on the way in — a persisted record is a plan, never a report of
    // what the vehicle is doing.
    const active = state.activeMission as Record<string, unknown> | null;
    if (active) {
      state.activeMission = { ...active, ...IDLE_EXECUTION };
    }
  }
  return state as unknown as MissionStoreState;
}

interface MissionStoreState {
  activeMission: Mission | null;
  waypoints: Waypoint[];
  progress: number;
  currentWaypoint: number;
  uploadState: "idle" | "uploading" | "uploaded" | "error";
  downloadState: "idle" | "downloading" | "downloaded" | "error";

  setMission: (mission: Mission | null) => void;
  setWaypoints: (waypoints: Waypoint[]) => void;
  addWaypoint: (waypoint: Waypoint) => void;
  insertWaypoint: (waypoint: Waypoint, atIndex: number) => void;
  removeWaypoint: (id: string) => void;
  updateWaypoint: (id: string, update: Partial<Waypoint>) => void;
  /**
   * Apply the same partial update to many waypoints as ONE undo entry. Use this
   * for batch edits (a single Ctrl+Z reverts the whole batch) instead of looping
   * ``updateWaypoint`` (which would record N entries).
   */
  batchUpdateWaypoints: (ids: string[], update: Partial<Waypoint>) => void;
  reorderWaypoints: (fromIndex: number, toIndex: number) => void;
  setProgress: (progress: number, currentWaypoint: number) => void;
  setMissionState: (state: MissionState) => void;
  setUploadState: (state: "idle" | "uploading" | "uploaded" | "error") => void;
  setDownloadState: (state: "idle" | "downloading" | "downloaded" | "error") => void;
  createMission: (name: string, droneId: string) => void;
  clearMission: () => void;
  /** Upload the mission to the FC. Resolves true on success, false on failure. */
  uploadMission: () => Promise<boolean>;
  downloadMission: () => Promise<Waypoint[]>;
  undo: () => void;
  redo: () => void;
}

export const useMissionStore = create<MissionStoreState>()(
  persist(
    (set, get) => ({
  activeMission: null,
  waypoints: [],
  progress: 0,
  currentWaypoint: 0,
  uploadState: "idle",
  downloadState: "idle",

  setMission: (activeMission) => set({
    activeMission,
    waypoints: activeMission?.waypoints ?? [],
    progress: activeMission?.progress ?? 0,
    currentWaypoint: activeMission?.currentWaypoint ?? 0,
  }),

  setWaypoints: (waypoints) => {
    recordHistory();
    set({ waypoints });
  },

  addWaypoint: (waypoint) => {
    recordHistory();
    set((s) => ({ waypoints: [...s.waypoints, waypoint] }));
  },

  insertWaypoint: (waypoint, atIndex) => {
    recordHistory();
    set((s) => {
      const wps = [...s.waypoints];
      wps.splice(atIndex, 0, waypoint);
      return { waypoints: wps };
    });
  },

  removeWaypoint: (id) => {
    recordHistory();
    set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) }));
  },

  updateWaypoint: (id, update) => {
    recordHistory();
    set((s) => ({
      waypoints: s.waypoints.map((w) =>
        w.id === id ? { ...w, ...update } : w
      ),
    }));
  },

  batchUpdateWaypoints: (ids, update) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    recordHistory();
    set((s) => ({
      waypoints: s.waypoints.map((w) =>
        idSet.has(w.id) ? { ...w, ...update } : w
      ),
    }));
  },

  reorderWaypoints: (fromIndex, toIndex) => {
    recordHistory();
    set((s) => {
      const wps = [...s.waypoints];
      const [moved] = wps.splice(fromIndex, 1);
      wps.splice(toIndex, 0, moved);
      return { waypoints: wps };
    });
  },

  setProgress: (progress, currentWaypoint) =>
    set({ progress, currentWaypoint }),

  setMissionState: (state) =>
    set((s) =>
      s.activeMission
        ? { activeMission: { ...s.activeMission, state } }
        : {}
    ),

  setUploadState: (uploadState) => set({ uploadState }),
  setDownloadState: (downloadState) => set({ downloadState }),

  createMission: (name, droneId) => {
    // A brand-new mission starts a fresh planner history — there is nothing to
    // undo back into the previous mission.
    clearHistory();
    set({
      activeMission: {
        id: Math.random().toString(36).substring(2, 10),
        name,
        droneId,
        waypoints: [],
        state: "planning",
        progress: 0,
        currentWaypoint: 0,
      },
      waypoints: [],
      progress: 0,
      currentWaypoint: 0,
      uploadState: "idle",
    });
  },

  clearMission: () => {
    recordHistory();
    set({
      activeMission: null,
      waypoints: [],
      progress: 0,
      currentWaypoint: 0,
      uploadState: "idle",
    });
  },

  undo: () => undoHistory(),

  redo: () => redoHistory(),

  uploadMission: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) return false;
    const { waypoints } = get();
    if (waypoints.length === 0) return false;

    set({ uploadState: "uploading" });

    // Each waypoint carries its own altitude frame; fall back to the mission's
    // default frame when a waypoint does not specify one. This matches what
    // mission file export/import preserve, so a mixed-frame mission uploads the
    // same frames it was saved with rather than coercing them all to one.
    const defaultFrame = usePlannerStore.getState().defaultFrame;

    // Flatten the waypoint model (NAV waypoints + their attached actions) into
    // the FC's contiguous `seq` item list. All wire-mapping and DO_JUMP target
    // resolution lives in this one pure module.
    const items: MissionItem[] = expandToItems(waypoints, { defaultFrame });

    try {
      const result = await protocol.uploadMission(items);
      set({ uploadState: result.success ? "uploaded" : "error" });
      return result.success;
    } catch {
      set({ uploadState: "error" });
      return false;
    }
  },

  downloadMission: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol) return [];

    set({ downloadState: "downloading" });

    try {
      const items = await protocol.downloadMission();
      // Re-nest the flat FC item list back into NAV waypoints with attached
      // actions, resolving each DO_JUMP's target seq to its owning waypoint id.
      const waypoints: Waypoint[] = collapseFromItems(items);
      set({ waypoints, downloadState: "downloaded" });
      return waypoints;
    } catch {
      set({ downloadState: "error" });
      return [];
    }
  },
    }),
    {
      name: "altcmd:mission-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 4,
      partialize: missionPartialize,
      migrate: migrateMissionStore,
    }
  )
);

// Register the waypoint half of the coordinated planner history. The history
// module snapshots / restores the waypoints array through this adapter so it can
// participate in the unified timeline without importing this store (which would
// create a cycle: mission-store → planner-history → mission-store). Waypoints are
// copied on capture and restore so a later mutation can never alias a stored
// snapshot.
registerWaypointAdapter({
  snapshot: () => useMissionStore.getState().waypoints.map((w) => ({ ...w })),
  restore: (snap) => {
    const waypoints = (snap as Waypoint[]).map((w) => ({ ...w }));
    useMissionStore.setState({ waypoints });
  },
});
