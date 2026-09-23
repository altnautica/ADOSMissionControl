/**
 * Follow-me mode state.
 *
 * A session is bound to one drone. `droneId` and `droneName` name the vehicle
 * the session is commanding, which is not necessarily the selected one while
 * the session is ending, so the stop control can say which aircraft it stops.
 *
 * @module follow-me-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

interface FollowMeState {
  isActive: boolean;
  isPaused: boolean;
  /** Managed drone id the active session commands, or null when idle. */
  droneId: string | null;
  /** Display name of that drone, or null when idle. */
  droneName: string | null;
  gcsAccuracy: number;  // meters
  lastUpdateMs: number;

  activate: (droneId: string, droneName: string) => void;
  deactivate: () => void;
  pause: () => void;
  resume: () => void;
  updateAccuracy: (accuracy: number) => void;
  updateTimestamp: () => void;
}

export const useFollowMeStore = create<FollowMeState>((set) => ({
  isActive: false,
  isPaused: false,
  droneId: null,
  droneName: null,
  gcsAccuracy: 0,
  lastUpdateMs: 0,

  activate: (droneId, droneName) =>
    set({ isActive: true, isPaused: false, droneId, droneName }),
  deactivate: () =>
    set({ isActive: false, isPaused: false, droneId: null, droneName: null, gcsAccuracy: 0 }),
  pause: () => set({ isPaused: true }),
  resume: () => set({ isPaused: false }),
  updateAccuracy: (accuracy) => set({ gcsAccuracy: accuracy }),
  updateTimestamp: () => set({ lastUpdateMs: Date.now() }),
}));
