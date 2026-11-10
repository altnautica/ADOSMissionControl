/**
 * @module cockpit/on-screen-sticks-shown
 * @description Whether the cockpit's on-screen sticks are on screen now. The
 * sticks publish it as they show and hide (their own rule: the setting on,
 * the pilot flying the sticks, no pad, a width class in `layout.json`
 * `on_screen_sticks.classes`); the pre-flight checklist reads it, so shown
 * sticks stand in for a controller.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";

interface OnScreenSticksShownState {
  shown: boolean;
  setShown: (shown: boolean) => void;
}

export const useOnScreenSticksShown = create<OnScreenSticksShownState>()((set) => ({
  shown: false,
  setShown: (shown) => set({ shown }),
}));
