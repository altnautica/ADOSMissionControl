/**
 * Operator profile store — pilot, organization, insurance, and defaults.
 *
 * Persisted to IndexedDB under `altcmd:operator-profile`. Loaded on app boot
 * (history page mount). Mirrors the history-store IDB pattern from Phase 2.
 *
 * @module stores/operator-profile-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { OperatorProfile } from "@/lib/types/operator";

const IDB_KEY = "altcmd:operator-profile";

interface State {
  profile: OperatorProfile;
  _loadedFromIdb: boolean;
}

interface Actions {
  /** Replace the entire profile (used by IDB load + form save). */
  setProfile: (profile: OperatorProfile) => void;
  /** Patch a subset of fields and persist. */
  updateProfile: (patch: Partial<OperatorProfile>) => void;
  /** Async: load persisted profile from IndexedDB. Idempotent. */
  loadFromIDB: () => Promise<void>;
  /** Async: write current profile to IndexedDB. */
  persistToIDB: () => Promise<void>;
}

export const useOperatorProfileStore = create<State & Actions>((set, get) => ({
  profile: { units: "metric" },
  _loadedFromIdb: false,

  setProfile: (profile) => set({ profile }),

  updateProfile: (patch) => {
    set((s) => ({ profile: { ...s.profile, ...patch } }));
    void get().persistToIDB();
  },

  loadFromIDB: async () => {
    if (get()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_KEY)) as OperatorProfile | undefined;
      if (stored && typeof stored === "object") {
        set({ profile: stored, _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[operator-profile-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      await idbSet(IDB_KEY, get().profile);
    } catch (err) {
      console.warn("[operator-profile-store] persistToIDB failed", err);
    }
  },
}));
