/**
 * Follow-me mode state.
 *
 * @module follow-me-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

interface FollowMeState {
  isActive: boolean;
  isPaused: boolean;
  gcsAccuracy: number;  // meters
  lastUpdateMs: number;

  activate: () => void;
  deactivate: () => void;
  pause: () => void;
  resume: () => void;
  updateAccuracy: (accuracy: number) => void;
  updateTimestamp: () => void;
}

export const useFollowMeStore = create<FollowMeState>((set) => ({
  isActive: false,
  isPaused: false,
  gcsAccuracy: 0,
  lastUpdateMs: 0,

  activate: () => set({ isActive: true, isPaused: false }),
  deactivate: () => set({ isActive: false, isPaused: false, gcsAccuracy: 0 }),
  pause: () => set({ isPaused: true }),
  resume: () => set({ isPaused: false }),
  updateAccuracy: (accuracy) => set({ gcsAccuracy: accuracy }),
  updateTimestamp: () => set({ lastUpdateMs: Date.now() }),
}));
