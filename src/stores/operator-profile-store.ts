/**
 * Operator profile store — pilot, organization, insurance, and defaults.
 *
 * Persisted to IndexedDB under `altcmd:operator-profile`. Loaded once at app
 * start by the root local-store hydrator; writes wait for that load.
 *
 * @module stores/operator-profile-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { OperatorProfile } from "@/lib/types/operator";
import { createIdbStoreLoader } from "@/lib/idb-store-loader";

const IDB_KEY = "altcmd:operator-profile";

interface State {
  profile: OperatorProfile;
}

interface Actions {
  /** Replace the entire profile (used by IDB load + form save). */
  setProfile: (profile: OperatorProfile) => void;
  /** Patch a subset of fields and persist. */
  updateProfile: (patch: Partial<OperatorProfile>) => void;
  /**
   * Async: read the persisted profile once and merge it into memory (stored
   * fields win). Idempotent; concurrent callers share one read.
   */
  ensureLoaded: () => Promise<void>;
  /** Async: write current profile to IndexedDB, after the load completes. */
  persistToIDB: () => Promise<void>;
}

export const useOperatorProfileStore = create<State & Actions>((set, get) => ({
  profile: { units: "metric" },

  setProfile: (profile) => set({ profile }),

  updateProfile: (patch) => {
    set((s) => ({ profile: { ...s.profile, ...patch } }));
    void get().persistToIDB();
  },

  ensureLoaded: () => idb.ensureLoaded(),

  persistToIDB: () => idb.persist(() => idbSet(IDB_KEY, get().profile)),
}));

const idb = createIdbStoreLoader("operator-profile-store", async () => {
  const stored = (await idbGet(IDB_KEY)) as OperatorProfile | undefined;
  if (stored && typeof stored === "object") {
    useOperatorProfileStore.setState((s) => ({ profile: { ...s.profile, ...stored } }));
  }
});
