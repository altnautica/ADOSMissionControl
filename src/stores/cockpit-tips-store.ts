/**
 * @module stores/cockpit-tips-store
 * @description What this device remembers about the flight screen's
 * contextual tips (cockpit spec `tips.json`): the tips dismissed for good and
 * how often the flight screen has opened. Settings › General › Reset tips
 * clears both.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { dismissTip, onFlightScreenOpen, resetTips, type TipsState } from "@/lib/hud/tips";

interface CockpitTipsStore extends TipsState {
  /** Mark a tip seen for good. */
  dismiss: (id: string) => void;
  /** Count one flight-screen open. */
  opened: () => void;
  /** Settings › Reset tips: every tip shows again. */
  reset: () => void;
}

export const useCockpitTipsStore = create<CockpitTipsStore>()(
  persist(
    (set) => ({
      ...resetTips(),
      dismiss: (id) => set((s) => dismissTip(s, id)),
      opened: () => set((s) => onFlightScreenOpen(s)),
      reset: () => set(resetTips()),
    }),
    {
      name: "altcmd:cockpit-tips",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ seen: s.seen, openCount: s.openCount }),
    },
  ),
);
