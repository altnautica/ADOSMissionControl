/**
 * @module CameraManagerStore
 * @description Per-drone state for the camera-management ("Cameras") tab: the
 * reconciled roster the agent last returned, plus the load / save / restart
 * flags the surface renders. This is config state (not ring-buffered telemetry),
 * so it is a plain non-persisted store — the roster is re-read from the agent on
 * each mount and after every write.
 *
 * A write to the agent is a whole-list replace + a video-pipeline restart, so
 * each mutation is applied OPTIMISTICALLY here for immediate feedback
 * (`patchCamera`), the write is issued by the tab, and the roster is then re-read
 * so the surface reflects the true persisted state (the read-back is
 * the source of truth, the optimistic patch is only a bridge across the restart
 * gap).
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { RosterCamera } from "@/lib/agent/feature-types";
import type { CameraPatch } from "@/lib/agent/camera-roster";

/** One drone's camera-management state. */
export interface DroneCameras {
  roster: RosterCamera[];
  /** A roster read is in flight. */
  loading: boolean;
  /** A write is in flight (the PUT itself). */
  saving: boolean;
  /** The agent is restarting the video pipeline after a write (~3 s). */
  restartPending: boolean;
  /** The last read/write error message, or null. */
  error: string | null;
}

const EMPTY_DRONE_CAMERAS: DroneCameras = {
  roster: [],
  loading: false,
  saving: false,
  restartPending: false,
  error: null,
};

interface CameraManagerState {
  byDrone: Record<string, DroneCameras>;

  /** Read a drone's state (never null — an unseen drone reads empty). */
  camerasFor: (droneId: string) => DroneCameras;
  /** Mark a roster read in flight. */
  beginLoad: (droneId: string) => void;
  /** Store a freshly-read roster (clears loading + error). */
  setRoster: (droneId: string, roster: RosterCamera[]) => void;
  /** Record a read/write failure (clears loading). */
  fail: (droneId: string, error: string) => void;
  /** Optimistically apply an edit to one roster row (bridges the restart gap
   * until the read-back confirms). `role: "primary"` demotes any other primary. */
  patchCamera: (droneId: string, id: string, patch: CameraPatch) => void;
  setSaving: (droneId: string, saving: boolean) => void;
  setRestartPending: (droneId: string, restartPending: boolean) => void;
  /** Drop a drone's state (on tab unmount / focus change). */
  clearForDrone: (droneId: string) => void;
}

/** Merge a partial update into one drone's slice, seeding from empty. */
function patchDrone(
  state: CameraManagerState,
  droneId: string,
  next: Partial<DroneCameras>,
): Partial<CameraManagerState> {
  const current = state.byDrone[droneId] ?? EMPTY_DRONE_CAMERAS;
  return {
    byDrone: { ...state.byDrone, [droneId]: { ...current, ...next } },
  };
}

export const useCameraManagerStore = create<CameraManagerState>((set, get) => ({
  byDrone: {},

  camerasFor: (droneId) => get().byDrone[droneId] ?? EMPTY_DRONE_CAMERAS,

  beginLoad: (droneId) =>
    set((state) => patchDrone(state, droneId, { loading: true, error: null })),

  setRoster: (droneId, roster) =>
    set((state) =>
      patchDrone(state, droneId, { roster, loading: false, error: null }),
    ),

  fail: (droneId, error) =>
    set((state) => patchDrone(state, droneId, { loading: false, error })),

  patchCamera: (droneId, id, patch) =>
    set((state) => {
      const current = state.byDrone[droneId];
      if (!current) return state;
      const roster = current.roster.map((cam) => {
        if (cam.id === id) return applyPatch(cam, patch);
        // Designating one camera primary demotes any other primary.
        if (patch.role === "primary" && cam.role === "primary") {
          return { ...cam, role: null };
        }
        return cam;
      });
      return patchDrone(state, droneId, { roster });
    }),

  setSaving: (droneId, saving) =>
    set((state) => patchDrone(state, droneId, { saving })),

  setRestartPending: (droneId, restartPending) =>
    set((state) => patchDrone(state, droneId, { restartPending })),

  clearForDrone: (droneId) =>
    set((state) => {
      if (!(droneId in state.byDrone)) return state;
      const byDrone = { ...state.byDrone };
      delete byDrone[droneId];
      return { byDrone };
    }),
}));

/** Apply an operator edit to a roster row (for the optimistic bridge). */
function applyPatch(cam: RosterCamera, patch: CameraPatch): RosterCamera {
  return {
    ...cam,
    name: patch.name !== undefined ? patch.name : cam.name,
    orientation:
      patch.orientation !== undefined ? patch.orientation : cam.orientation,
    purpose: patch.purpose !== undefined ? [...patch.purpose] : cam.purpose,
    enabled: patch.enabled !== undefined ? patch.enabled : cam.enabled,
    role: patch.role !== undefined ? patch.role : cam.role,
    fov_deg: patch.fov_deg !== undefined ? patch.fov_deg : cam.fov_deg,
    mount_pitch_deg:
      patch.mount_pitch_deg !== undefined
        ? patch.mount_pitch_deg
        : cam.mount_pitch_deg,
  };
}
