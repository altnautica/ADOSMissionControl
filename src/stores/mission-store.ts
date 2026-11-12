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
import type {
  Mission,
  Waypoint,
  MissionState,
  PlannedHome,
  PlanVehicleProfile,
} from "@/lib/types";
import type { DroneProtocol } from "@/lib/protocol/types";
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
import { missionContentHash, missionSeqToWaypointIndex } from "@/lib/mission-upload";
import { receiptFor } from "./upload-receipts-store";
import { readPersistedDefaultFrame } from "@/lib/mission/mission-frame";
import { missionPartialize, migrateMissionStore } from "./mission-store-persist";
import { downloadPlanMission, planWireSettings, uploadPlanMission } from "./mission-transfer";

/** A terrain sample taken at a waypoint's position (metres MSL). */
export interface GroundElevationSample {
  id: string;
  lat: number;
  lon: number;
  groundElevation: number;
}

/**
 * `groundElevation` is derived from lat/lon. When an edit moves a waypoint, the
 * old sample describes ground the waypoint no longer sits over, so it is
 * dropped and the terrain sync resamples the new position. A waypoint with no
 * earlier version (a loaded or newly placed one) keeps what it carries.
 */
function dropMovedGround(prev: Waypoint | undefined, next: Waypoint): Waypoint {
  if (next.groundElevation === undefined || !prev) return next;
  if (prev.lat === next.lat && prev.lon === next.lon) return next;
  const { groundElevation: _stale, ...rest } = next;
  return rest;
}

export interface MissionStoreState {
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
  /** The flight controller's or transport's reason for the last failed
   *  upload; null when the last upload succeeded or none has failed. */
  uploadError: string | null;
  /** How the last failed upload ended as a code the UI puts into words
   *  (`missionResultKey`): the vehicle's MAV_MISSION_RESULT or a transfer
   *  outcome. Null when `uploadError` is already operator text (the upload
   *  was refused before anything was sent) or nothing failed. */
  uploadErrorCode: number | null;
  /** Items the vehicle has taken during the running upload, out of the total;
   *  null before the first upload starts. */
  uploadProgress: { sent: number; total: number } | null;
  downloadState: "idle" | "downloading" | "downloaded" | "error";
  /** Why the last download failed; null when it did not. */
  downloadError: string | null;
  /** Items the last download could not keep, named for the operator. */
  downloadWarnings: string[];
  /** Where the plan expects to launch and return; `null` until set or seeded. */
  plannedHome: PlannedHome | null;
  /** The autopilot and vehicle class the plan is written for; `null` = follow the vehicle. */
  vehicleProfile: PlanVehicleProfile | null;
  /** Height above home flown to and from the work area; `null` = off. */
  transitAltM: number | null;

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
  /**
   * Write terrain samples outside the undo timeline. A sample is derived from
   * its waypoint's position, so it lands only when the waypoint still sits at
   * the sampled lat/lon; a sample for a position the waypoint has left is
   * dropped.
   */
  applyGroundElevations: (samples: readonly GroundElevationSample[]) => void;
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
  /**
   * Set the planned home. One undo step, unless `history: false` (a derived
   * seed or a ground-elevation fill, which the operator did not make).
   */
  setPlannedHome: (home: PlannedHome | null, opts?: { history?: boolean }) => void;
  /** Set the plan's vehicle profile (one undo step). */
  setVehicleProfile: (profile: PlanVehicleProfile | null) => void;
  /** Set the transit altitude in metres above home; `null` or ≤ 0 turns it off (one undo step). */
  setTransitAlt: (altM: number | null) => void;
  /** Upload the current waypoints, with the plan's transit legs. `target`
   *  pins the destination drone; when omitted the operator's selected drone
   *  is used. A caller scoped to one drone MUST pass `target` — the selection
   *  fallback sent a plugin's mission write to whichever aircraft the
   *  operator happened to be watching. `waypoints` uploads that list in place
   *  of the plan (a resume mission); it records no upload receipt, and the
   *  vehicle no longer counts as holding the plan. */
  uploadMission: (target?: DroneProtocol, opts?: { waypoints?: Waypoint[] }) => Promise<boolean>;
  /** Download the selected drone's mission and replace the plan with it. A
   *  failed or unsupported download sets `downloadState: "error"` and leaves
   *  the plan untouched; so does an empty download, because the vehicle having
   *  no mission is no reason to wipe the open plan. A download replaces the
   *  plan settings too: ArduPilot's home slot becomes the planned home, the
   *  transit altitude goes (the vehicle's items hold any transit legs) and the
   *  plan follows the vehicle's own profile. */
  downloadMission: () => Promise<Waypoint[]>;
  undo: () => void;
  redo: () => void;
}

let missionHydrationDone = false;
let missionHydrationError = false;
const missionHydrationListeners = new Set<() => void>();

export const useMissionStore = create<MissionStoreState>()(
  persist<MissionStoreState, [], [], Partial<MissionStoreState>>(
    (set, get) => ({
  activeMission: null,
  waypoints: [],
  progress: 0,
  currentWaypoint: null,
  uploadState: "idle",
  uploadError: null,
  uploadErrorCode: null,
  uploadProgress: null,
  downloadState: "idle",
  downloadError: null,
  downloadWarnings: [],
  plannedHome: null,
  vehicleProfile: null,
  transitAltM: null,

  setMission: (activeMission) => set({
    activeMission,
    waypoints: activeMission?.waypoints ?? [],
    progress: 0,
    currentWaypoint: null,
  }),

  setWaypoints: (waypoints) =>
    withPlannerHistory(() =>
      set((s) => {
        const prevById = new Map(s.waypoints.map((w) => [w.id, w]));
        return { waypoints: waypoints.map((w) => dropMovedGround(prevById.get(w.id), w)) };
      }),
    ),

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
          w.id === id
            ? dropMovedGround(w, { ...w, ...update, ...(moved ? { inheritsPosition: undefined } : {}) })
            : w
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
          idSet.has(w.id) ? dropMovedGround(w, { ...w, ...update }) : w
        ),
      })),
    );
  },

  applyGroundElevations: (samples) => {
    if (samples.length === 0) return;
    const byId = new Map(samples.map((s) => [s.id, s]));
    let changed = false;
    const waypoints = get().waypoints.map((w) => {
      const sample = byId.get(w.id);
      if (!sample || sample.lat !== w.lat || sample.lon !== w.lon) return w;
      if (w.groundElevation === sample.groundElevation) return w;
      changed = true;
      return { ...w, groundElevation: sample.groundElevation };
    });
    // A plain set: a derived sample is never an undo step and never clears redo.
    if (changed) set({ waypoints });
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
    const state = get();
    const { waypoints } = state;
    const wire = planWireSettings(state);
    const receipt = receiptFor("mission", droneId);
    const matches =
      receipt !== undefined && receipt.contentHash === missionContentHash(waypoints, wire);
    const index = matches
      ? missionSeqToWaypointIndex(waypoints, seq, receipt.homeSlot ?? false, wire)
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
        plannedHome: null,
        vehicleProfile: null,
        transitAltM: null,
      }),
    );
  },

  setPlannedHome: (plannedHome, opts) => {
    if (opts?.history === false) {
      set({ plannedHome });
      return;
    }
    withPlannerHistory(() => set({ plannedHome }));
  },

  setVehicleProfile: (vehicleProfile) => withPlannerHistory(() => set({ vehicleProfile })),

  setTransitAlt: (altM) =>
    withPlannerHistory(() =>
      set({ transitAltM: altM !== null && Number.isFinite(altM) && altM > 0 ? altM : null }),
    ),

  undo: () => undoHistory(),

  redo: () => redoHistory(),

  uploadMission: (target, opts) => uploadPlanMission(get, set, target, opts),

  downloadMission: () => downloadPlanMission(set),
    }),
    {
      name: "altcmd:mission-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 7,
      partialize: missionPartialize,
      migrate: async (persisted, version) =>
        migrateMissionStore(persisted, version, await readPersistedDefaultFrame()),
      // Fires on success and on a rejected read or migration (zustand leaves
      // `hasHydrated()` false then), so nothing waits forever on persisted
      // state that is not coming; the defaults stand.
      onRehydrateStorage: () => (_state, error) => {
        missionHydrationDone = true;
        missionHydrationError = error !== undefined;
        missionHydrationListeners.forEach((cb) => cb());
      },
    }
  )
);

/** The persisted plan has loaded, or the load failed and the defaults stand. */
export function missionHydrationSettled(): boolean {
  return missionHydrationDone || useMissionStore.persist.hasHydrated();
}

/** The persisted plan could not be read: nothing written this session will be kept. */
export function missionHydrationFailed(): boolean {
  return missionHydrationError;
}

/** Subscribe to {@link missionHydrationSettled} turning true; returns the unsubscribe. */
export function onMissionHydrationSettled(cb: () => void): () => void {
  missionHydrationListeners.add(cb);
  return () => {
    missionHydrationListeners.delete(cb);
  };
}

// Register the plan half of the coordinated planner history: the waypoints and
// the plan settings that live in this store. The history module snapshots /
// restores it through this adapter so it can participate in the unified
// timeline without importing this store (which would create a cycle:
// mission-store → planner-history → mission-store). Waypoints are copied on
// capture and restore so a later mutation can never alias a stored snapshot.
interface MissionHistorySnapshot {
  waypoints: Waypoint[];
  plannedHome: PlannedHome | null;
  vehicleProfile: PlanVehicleProfile | null;
  transitAltM: number | null;
}

registerWaypointAdapter({
  snapshot: (): MissionHistorySnapshot => {
    const s = useMissionStore.getState();
    return {
      waypoints: s.waypoints.map((w) => ({ ...w })),
      plannedHome: s.plannedHome,
      vehicleProfile: s.vehicleProfile,
      transitAltM: s.transitAltM,
    };
  },
  restore: (snap) => {
    const s = snap as MissionHistorySnapshot;
    useMissionStore.setState({
      waypoints: s.waypoints.map((w) => ({ ...w })),
      plannedHome: s.plannedHome,
      vehicleProfile: s.vehicleProfile,
      transitAltM: s.transitAltM,
    });
  },
});
