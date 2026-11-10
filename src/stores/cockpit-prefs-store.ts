/**
 * @module cockpit-prefs-store
 * @description Cockpit preferences that live on this surface: voice prompts
 * (Settings › Sound, default on) and on-screen sticks (Settings › Controls,
 * default off), per the shared cockpit spec.
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import layoutSpec from "@/lib/cockpit-spec/layout.json";

interface CockpitPrefsState {
  voicePrompts: boolean;
  onScreenSticks: boolean;
  setVoicePrompts: (on: boolean) => void;
  setOnScreenSticks: (on: boolean) => void;
}

export const useCockpitPrefsStore = create<CockpitPrefsState>()(
  persist(
    (set) => ({
      voicePrompts: true,
      onScreenSticks: layoutSpec.on_screen_sticks.default,
      setVoicePrompts: (voicePrompts) => set({ voicePrompts }),
      setOnScreenSticks: (onScreenSticks) => set({ onScreenSticks }),
    }),
    {
      name: "altcmd:cockpit-prefs",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ voicePrompts: s.voicePrompts, onScreenSticks: s.onScreenSticks }),
    },
  ),
);
