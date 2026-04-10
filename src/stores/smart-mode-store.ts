/**
 * @module SmartModeStore
 * @description Zustand store for active smart mode behavior runtime state.
 * Tracks which behavior is running, its execution state, selected QuickShot
 * sub-type, and runtime-adjusted parameters.
 * @license GPL-3.0-only
 */

import { create } from "zustand";

export type BehaviorState =
  | "idle"
  | "designating"
  | "searching"
  | "tracking"
  | "executing"
  | "paused";

interface SmartModeState {
  /** Currently active behavior ID (e.g. "follow-me", "orbit"), or null. */
  activeBehavior: string | null;
  /** Execution state of the active behavior. */
  behaviorState: BehaviorState | null;
  /** Selected QuickShot sub-type (e.g. "quickshot-dronie"), or null. */
  selectedQuickShot: string | null;
  /** Runtime-adjusted parameters for the active behavior. */
  behaviorParams: Record<string, unknown>;
}

interface SmartModeActions {
  setActiveBehavior: (behaviorId: string | null) => void;
  setBehaviorState: (state: BehaviorState | null) => void;
  setSelectedQuickShot: (shotId: string | null) => void;
  updateParam: (key: string, value: unknown) => void;
  clear: () => void;
}

export type SmartModeStore = SmartModeState & SmartModeActions;

export const useSmartModeStore = create<SmartModeStore>((set) => ({
  activeBehavior: null,
  behaviorState: null,
  selectedQuickShot: null,
  behaviorParams: {},

  setActiveBehavior(behaviorId: string | null) {
    set({
      activeBehavior: behaviorId,
      behaviorState: behaviorId ? "idle" : null,
      behaviorParams: {},
    });
  },

  setBehaviorState(state: BehaviorState | null) {
    set({ behaviorState: state });
  },

  setSelectedQuickShot(shotId: string | null) {
    set({ selectedQuickShot: shotId });
  },

  updateParam(key: string, value: unknown) {
    set((s) => ({
      behaviorParams: { ...s.behaviorParams, [key]: value },
    }));
  },

  clear() {
    set({
      activeBehavior: null,
      behaviorState: null,
      selectedQuickShot: null,
      behaviorParams: {},
    });
  },
}));
