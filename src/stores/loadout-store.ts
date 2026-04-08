/**
 * Per-drone "next-flight" loadout selection.
 *
 * The user picks a loadout (battery + props + motors + camera + payload …)
 * for each drone before arming. The flight lifecycle reads the matching
 * entry on arm and freezes it into the FlightRecord. On disarm, the
 * lifecycle calls `recordCycle()` on every battery in the loadout and
 * `recordFlight()` on every equipment item, advancing usage stats.
 *
 * Persisted to IndexedDB so the picker survives reload — operators rarely
 * swap props between flights, so the previous loadout is the right default.
 *
 * @module stores/loadout-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { LoadoutSnapshot } from "@/lib/types";

const IDB_KEY = "altcmd:loadouts";

interface State {
  /** droneId → current loadout. */
  loadouts: Record<string, LoadoutSnapshot>;
  _loadedFromIdb: boolean;
}

interface Actions {
  get: (droneId: string) => LoadoutSnapshot | undefined;
  set: (droneId: string, loadout: LoadoutSnapshot) => void;
  patch: (droneId: string, patch: Partial<LoadoutSnapshot>) => void;
  clear: (droneId: string) => void;
  loadFromIDB: () => Promise<void>;
  persistToIDB: () => Promise<void>;
}

export const useLoadoutStore = create<State & Actions>((set, getState) => ({
  loadouts: {},
  _loadedFromIdb: false,

  get: (droneId) => getState().loadouts[droneId],

  set: (droneId, loadout) => {
    set((s) => ({ loadouts: { ...s.loadouts, [droneId]: loadout } }));
    void getState().persistToIDB();
  },

  patch: (droneId, patch) => {
    set((s) => {
      const existing = s.loadouts[droneId] ?? {};
      return {
        loadouts: {
          ...s.loadouts,
          [droneId]: { ...existing, ...patch },
        },
      };
    });
    void getState().persistToIDB();
  },

  clear: (droneId) => {
    set((s) => {
      const next = { ...s.loadouts };
      delete next[droneId];
      return { loadouts: next };
    });
    void getState().persistToIDB();
  },

  loadFromIDB: async () => {
    if (getState()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_KEY)) as Record<string, LoadoutSnapshot> | undefined;
      if (stored && typeof stored === "object") {
        set({ loadouts: stored, _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[loadout-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      await idbSet(IDB_KEY, getState().loadouts);
    } catch (err) {
      console.warn("[loadout-store] persistToIDB failed", err);
    }
  },
}));
