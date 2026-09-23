/**
 * Guided mode state — the active "fly here" / "land here" target and the
 * pending Fly Here confirmation.
 *
 * Both are keyed to the drone they were issued for. The store is a single
 * global slot, so an unkeyed target would be re-measured against whichever
 * drone is selected next, and a pending confirmation would re-open for it.
 * The target's lifecycle (arrival, mode change, cancel) is owned by
 * `@/lib/skills/guided-target`; surfaces only read it.
 *
 * @module guided-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export interface GuidedTarget {
  droneId: string;
  lat: number;
  lon: number;
  alt: number;       // meters relative to home
  timestamp: number;  // when the vehicle accepted the reposition
  /** "goto" for Fly Here; "land" while Land Here repositions before descending. */
  purpose: "goto" | "land";
}

export interface GuidedConfirmPending {
  droneId: string;
  lat: number;
  lon: number;
  screenX: number;
  screenY: number;
}

interface GuidedStoreState {
  /** Active guided target, or null if none. */
  target: GuidedTarget | null;
  /** The Fly Here confirmation awaiting the operator, or null. */
  confirmPending: GuidedConfirmPending | null;

  setTarget: (target: GuidedTarget | null) => void;
  showConfirm: (pending: GuidedConfirmPending) => void;
  dismissConfirm: () => void;
  clearTarget: () => void;
}

export const useGuidedStore = create<GuidedStoreState>((set) => ({
  target: null,
  confirmPending: null,

  setTarget: (target) => set({ target, confirmPending: null }),

  showConfirm: (pending) => set({ confirmPending: pending }),

  dismissConfirm: () => set({ confirmPending: null }),

  clearTarget: () => set({ target: null }),
}));
