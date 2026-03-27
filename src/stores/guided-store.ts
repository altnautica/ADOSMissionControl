/**
 * Guided mode state — tracks active "fly here" targets.
 *
 * @module guided-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface GuidedTarget {
  lat: number;
  lon: number;
  alt: number;       // meters (relative to home or AMSL depending on frame)
  timestamp: number;  // when the target was set
}

interface GuidedStoreState {
  /** Active guided target, or null if none. */
  target: GuidedTarget | null;
  /** Whether confirmation dialog is open. */
  confirmPending: {
    lat: number;
    lon: number;
    screenX: number;
    screenY: number;
  } | null;

  setTarget: (target: GuidedTarget | null) => void;
  showConfirm: (lat: number, lon: number, screenX: number, screenY: number) => void;
  dismissConfirm: () => void;
  clearTarget: () => void;
}

export const useGuidedStore = create<GuidedStoreState>((set) => ({
  target: null,
  confirmPending: null,

  setTarget: (target) => set({ target, confirmPending: null }),

  showConfirm: (lat, lon, screenX, screenY) =>
    set({ confirmPending: { lat, lon, screenX, screenY } }),

  dismissConfirm: () => set({ confirmPending: null }),

  clearTarget: () => set({ target: null }),
}));
