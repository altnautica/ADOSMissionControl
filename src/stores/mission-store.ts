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
import type { DroneProtocol, MissionItem } from "@/lib/protocol/types";
import { droneSelection, selectedDroneProtocol } from "./drone-selection";
import { useTelemetryStore } from "./telemetry-store";
import { indexedDBStorage } from "@/lib/storage";
import {
  withPlannerHistory,
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
// The pure mission ⇄ wire collapser: re-nests a downloaded flat item list into
// the waypoint model. The upload side goes through `mission-upload`, which also
// owns the receipt hash and the seq → waypoint mapping, so the three agree.
import { collapseFromItems, type HomeSlot } from "@/lib/mission/mission-expand";
import {
  missionUploadItems,
  missionContentHash,
  missionSeqToWaypointIndex,
} from "@/lib/mission-upload";
import { useUploadReceiptsStore, receiptFor } from "./upload-receipts-store";
import { foldLegacyWaypoints } from "@/lib/mission/flat-rows";
import { migrateWaypointSlots } from "@/lib/mission/waypoint-slot-migration";
import { droppedItemWarning } from "@/lib/mission-io-formats";

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
): Partial<MissionStoreState> {
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
  if (version < 5) {
    // v5 maps the iNav action onto `command` and moves the LOITER_TURNS /
    // PAYLOAD_PLACE editor values into the slots that reach the right
    // MAVLink parameter.
    if (Array.isArray(state.waypoints)) {
      state.waypoints = migrateWaypointSlots(state.waypoints as Waypoint[]);
    }
  }
  return state as Partial<MissionStoreState>;
}

/**
 * The home position written into ArduPilot's mission slot 0: the vehicle's
 * HOME_POSITION when this is the selected drone and one has been received,
 * else the first waypoint at 0 m. The flight controller replaces slot 0 with
 * its own home on arming, so the fallback only has to be a valid position.
 */
export function uploadHome(protocol: DroneProtocol, waypoints: readonly Waypoint[]): HomeSlot {
  const isSelected = selectedDroneProtocol() === protocol;
  const home = isSelected ? useTelemetryStore.getState().homePosition.latest() : undefined;
  if (home) return { lat: home.lat, lon: home.lon, alt: home.alt };
  return { lat: waypoints[0]?.lat ?? 0, lon: waypoints[0]?.lon ?? 0, alt: 0 };
}

interface MissionStoreState {
  activeMission: Mission | null;
  waypoints: Waypoint[];
  /** Mission progress 0-100 from the FC's current item; 0 when unknown. */
  progress: number;
  /**
   * Planner index of the waypoint the FC is flying, from MISSION_CURRENT.
   * `null` when unknown: no MISSION_CURRENT yet, or the FC holds a mission this
   * planner did not upload (no receipt, or the plan was edited since), so its
   * seq cannot be mapped onto these waypoints.
   */
  currentWaypoint: number | null;
  /** Transfer status of the last upload attempt. Whether the aircraft holds
   *  THIS plan is a separate question, answered by the upload receipt. */
  uploadState: "idle" | "uploading" | "uploaded" | "error";
  downloadState: "idle" | "downloading" | "downloaded" | "error";
  /** Items the last download could not keep, named for the operator. */
  downloadWarnings: string[];

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
  /**
   * Feed the FC's MISSION_CURRENT seq for `droneId`. The seq maps onto a
   * planner waypoint only when that drone's upload receipt matches the current
   * plan; otherwise progress reads as unknown.
   */
  applyMissionCurrent: (droneId: string, seq: number) => void;
  setMissionState: (state: MissionState) => void;
  setUploadState: (state: "idle" | "uploading" | "uploaded" | "error") => void;
  setDownloadState: (state: "idle" | "downloading" | "downloaded" | "error") => void;
  createMission: (name: string, droneId: string) => void;
  clearMission: () => void;
  /** Upload the current waypoints. `target` pins the destination drone; when
   *  omitted the operator's selected drone is used. A caller scoped to one
   *  drone MUST pass `target` — the selection fallback sent a plugin's mission
   *  write to whichever aircraft the operator happened to be watching. */
  uploadMission: (target?: DroneProtocol) => Promise<boolean>;
  /** Download the selected drone's mission and replace the plan with it. A
   *  failed or unsupported download sets `downloadState: "error"` and leaves
   *  the plan untouched. */
  downloadMission: () => Promise<Waypoint[]>;
  undo: () => void;
  redo: () => void;
}

/** The drone id a protocol instance belongs to, if it is still managed. */
function droneIdOf(protocol: DroneProtocol): string | null {
  for (const [id, drone] of droneSelection().drones) {
    if (drone.protocol === protocol) return id;
  }
  return null;
}

export const useMissionStore = create<MissionStoreState>()(
  persist<MissionStoreState, [], [], Partial<MissionStoreState>>(
    (set, get) => ({
  activeMission: null,
  waypoints: [],
  progress: 0,
  currentWaypoint: null,
  uploadState: "idle",
  downloadState: "idle",
  downloadWarnings: [],

  setMission: (activeMission) => set({
    activeMission,
    waypoints: activeMission?.waypoints ?? [],
    progress: 0,
    currentWaypoint: null,
  }),

  setWaypoints: (waypoints) => withPlannerHistory(() => set({ waypoints })),

  addWaypoint: (waypoint) =>
    withPlannerHistory(() => set((s) => ({ waypoints: [...s.waypoints, waypoint] }))),

  insertWaypoint: (waypoint, atIndex) =>
    withPlannerHistory(() =>
      set((s) => {
        const wps = [...s.waypoints];
        wps.splice(atIndex, 0, waypoint);
        return { waypoints: wps };
      }),
    ),

  removeWaypoint: (id) =>
    withPlannerHistory(() => set((s) => ({ waypoints: s.waypoints.filter((w) => w.id !== id) }))),

  updateWaypoint: (id, update) => {
    // Moving a position-inheriting item gives it a real position.
    const moved = ("lat" in update || "lon" in update) && !("inheritsPosition" in update);
    withPlannerHistory(() =>
      set((s) => ({
        waypoints: s.waypoints.map((w) =>
          w.id === id ? { ...w, ...update, ...(moved ? { inheritsPosition: undefined } : {}) } : w
        ),
      })),
    );
  },

  batchUpdateWaypoints: (ids, update) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    withPlannerHistory(() =>
      set((s) => ({
        waypoints: s.waypoints.map((w) =>
          idSet.has(w.id) ? { ...w, ...update } : w
        ),
      })),
    );
  },

  reorderWaypoints: (fromIndex, toIndex) =>
    withPlannerHistory(() =>
      set((s) => {
        const wps = [...s.waypoints];
        const [moved] = wps.splice(fromIndex, 1);
        wps.splice(toIndex, 0, moved);
        return { waypoints: wps };
      }),
    ),

  applyMissionCurrent: (droneId, seq) => {
    const { waypoints } = get();
    const receipt = receiptFor("mission", droneId);
    const matches =
      receipt !== undefined && receipt.contentHash === missionContentHash(waypoints);
    const index = matches
      ? missionSeqToWaypointIndex(waypoints, seq, receipt.homeSlot ?? false)
      : null;
    set({
      currentWaypoint: index,
      progress: index === null ? 0 : Math.round(((index + 1) / waypoints.length) * 100),
    });
  },

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
      currentWaypoint: null,
      uploadState: "idle",
    });
  },

  clearMission: () => {
    withPlannerHistory(() =>
      set({
        activeMission: null,
        waypoints: [],
        progress: 0,
        currentWaypoint: null,
        uploadState: "idle",
      }),
    );
  },

  undo: () => undoHistory(),

  redo: () => redoHistory(),

  uploadMission: async (target) => {
    // The target is explicit for callers scoped to a specific drone (the
    // plugin host, which must never fall back to the operator's selection);
    // it defaults to the selected drone for the planner's own Upload button.
    const protocol = target ?? selectedDroneProtocol();
    if (!protocol) return false;
    const { waypoints } = get();
    if (waypoints.length === 0) return false;

    set({ uploadState: "uploading" });

    // Flatten the waypoint model (NAV waypoints + their attached actions) into
    // the FC's contiguous `seq` item list, with each frame-less waypoint taking
    // the mission's default frame. ArduPilot keeps home in slot 0 and starts
    // the mission at slot 1, so the home slot is reserved there.
    const isArduPilot = protocol.getVehicleInfo()?.firmwareType.startsWith("ardupilot-") ?? false;
    const items: MissionItem[] = missionUploadItems(
      waypoints,
      isArduPilot ? uploadHome(protocol, waypoints) : undefined,
    );
    // Hash what is being sent now: an edit made while the transfer runs must
    // not be vouched for by this upload's receipt.
    const uploadedHash = missionContentHash(waypoints);
    const droneId = droneIdOf(protocol);
    const receipts = useUploadReceiptsStore.getState();

    let success = false;
    try {
      success = (await protocol.uploadMission(items)).success;
    } catch {
      success = false;
    }
    set({ uploadState: success ? "uploaded" : "error" });
    if (droneId) {
      // A failed transfer may have left the FC with a partial or cleared
      // mission, so what it holds is no longer known.
      if (success) {
        receipts.record("mission", {
          droneId,
          contentHash: uploadedHash,
          at: Date.now(),
          homeSlot: isArduPilot,
        });
      } else {
        receipts.clearKindForDrone("mission", droneId);
      }
    }
    return success;
  },

  downloadMission: async () => {
    const protocol = selectedDroneProtocol();
    if (!protocol) return [];

    set({ downloadState: "downloading", downloadWarnings: [] });

    try {
      const downloaded = await protocol.downloadMission();
      // ArduPilot's slot 0 is the home position, not a mission item. Jump
      // targets keep their absolute seq, which collapse resolves directly.
      const isArduPilot = protocol.getVehicleInfo()?.firmwareType.startsWith("ardupilot-") ?? false;
      const items = isArduPilot ? downloaded.filter((it) => it.seq !== 0) : downloaded;
      // The home slot anchors items the vehicle flies "from here" (RTL, 0,0
      // TAKEOFF/LAND/LOITER) when no waypoint precedes them.
      const homeItem = isArduPilot ? downloaded.find((it) => it.seq === 0) : undefined;
      const home = homeItem && (homeItem.x !== 0 || homeItem.y !== 0)
        ? { lat: homeItem.x / 1e7, lon: homeItem.y / 1e7 }
        : undefined;
      // Re-nest the flat FC item list back into NAV waypoints with attached
      // actions, resolving each DO_JUMP's target seq to its owning waypoint id.
      const downloadWarnings: string[] = [];
      const waypoints: Waypoint[] = collapseFromItems(items, (dropped) => {
        downloadWarnings.push(droppedItemWarning(dropped));
      }, home);
      // Replacing the operator's plan with the FC's is a planner edit: one
      // undo step brings the local plan back.
      withPlannerHistory(() => set({ waypoints }));
      set({ downloadState: "downloaded", downloadWarnings });
      // The planner now shows what the FC holds, unless an item could not be
      // kept (then the two differ and nothing vouches for the plan).
      const droneId = droneIdOf(protocol);
      if (droneId && downloadWarnings.length === 0) {
        useUploadReceiptsStore.getState().record("mission", {
          droneId,
          contentHash: missionContentHash(waypoints),
          at: Date.now(),
          homeSlot: isArduPilot,
        });
      }
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
      version: 5,
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
