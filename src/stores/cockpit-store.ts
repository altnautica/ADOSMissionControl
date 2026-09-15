/**
 * Cockpit skill-layer flag.
 *
 * Default ON. It shipped default-off with the cockpit gated behind an opt-in
 * card parked over the boresight, on a piloting surface, with half the
 * keyboard responding (stream digits and PiP worked; the command palette and
 * quick settings did not) and no indication which half. A flight surface
 * whose controls are inert until an operator finds a prompt is not a safer
 * default, it is a surface that behaves differently in the air than it did on
 * the bench. An operator who wants it off can still turn it off, and that
 * choice persists.
 *
 * @module cockpit-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

interface CockpitState {
  /** Whether the cockpit surfaces (Skill Bar) are enabled. */
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  toggle: () => void;
}

/** Current localStorage key. */
const STORAGE_KEY = "altcmd:cockpit";
/** Prior localStorage key, honored once on read then migrated over. */
const LEGACY_STORAGE_KEY = "altcmd:fly-mode";

/**
 * Storage that rename-migrates the prior key on read: if nothing is stored
 * under the current key but a value exists under the old one, adopt it (and
 * clear the old key) so an operator's opt-in survives the rename.
 */
const cockpitStorage = createJSONStorage(() =>
  typeof window !== "undefined"
    ? {
        getItem: (name: string) => {
          const current = window.localStorage.getItem(name);
          if (current !== null) return current;
          const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
          if (legacy !== null) {
            window.localStorage.setItem(name, legacy);
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
            return legacy;
          }
          return null;
        },
        setItem: (name: string, value: string) =>
          window.localStorage.setItem(name, value),
        removeItem: (name: string) => window.localStorage.removeItem(name),
      }
    : {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
);

export const useCockpitStore = create<CockpitState>()(
  persist(
    (set, get) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
      toggle: () => set({ enabled: !get().enabled }),
    }),
    {
      name: STORAGE_KEY,
      storage: cockpitStorage,
      version: 3,
      // v2 and earlier persisted the flag on every install that opened the
      // cockpit even once, so a stored `false` records the old DEFAULT rather
      // than a decision. The v3 migration drops it and adopts the new
      // default; anything the operator turns off from here is persisted
      // normally and survives.
      migrate: (persisted, version) => {
        const state = persisted as Partial<CockpitState>;
        if (version < 3) return { ...state, enabled: true } as CockpitState;
        return state as CockpitState;
      },
    },
  ),
);
