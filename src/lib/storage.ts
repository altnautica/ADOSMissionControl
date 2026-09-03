/**
 * @module storage
 * @description Shared IndexedDB storage engine for Zustand persist middleware.
 * Uses idb-keyval (~600 bytes) for simple key-value storage in IndexedDB.
 * All Command GCS persistent data flows through this module.
 * @license GPL-3.0-only
 */

import { get, set, del } from "idb-keyval";
import type { StateStorage } from "zustand/middleware";

const idbStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    return (await get(name)) ?? null;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    await set(name, value);
  },
  removeItem: async (name: string): Promise<void> => {
    await del(name);
  },
};

/**
 * Fallback for environments with no IndexedDB: server rendering, the test
 * runner, and a browser that has blocked storage (Safari private browsing
 * refuses to open a database).
 *
 * idb-keyval reaches for the global `indexedDB` on first use, so without this
 * every persisted store throws `ReferenceError: indexedDB is not defined` the
 * moment its middleware hydrates — which is what a persisted geofence store
 * did to its entire test file.
 *
 * The data genuinely does not survive a reload here, and that is the honest
 * behaviour for a platform that has no durable store: a Map that forgets is
 * the truth, where a throw is a crash and a silent no-op would let a caller
 * believe a fence was saved.
 */
function createMemoryStorage(): StateStorage {
  const cells = new Map<string, string>();
  return {
    getItem: (name) => Promise.resolve(cells.get(name) ?? null),
    setItem: (name, value) => {
      cells.set(name, value);
      return Promise.resolve();
    },
    removeItem: (name) => {
      cells.delete(name);
      return Promise.resolve();
    },
  };
}

/**
 * Whether this environment can persist at all. Evaluated per call rather than
 * cached at module load, because a module-eval snapshot would be taken before
 * a test harness installs its own shim.
 */
export function isPersistentStorageAvailable(): boolean {
  return typeof globalThis !== "undefined" && "indexedDB" in globalThis && globalThis.indexedDB != null;
}

let warned = false;

export const indexedDBStorage = {
  storage: (): StateStorage => {
    if (isPersistentStorageAvailable()) return idbStorage;
    if (!warned && typeof console !== "undefined") {
      warned = true;
      // Once per session, not per store: a browser that cannot persist should
      // say so somewhere an operator or a bug report can find it, without
      // burying the console under one line per persisted store.
      console.warn(
        "[storage] IndexedDB is unavailable; persisted state is in-memory for this session and will not survive a reload.",
      );
    }
    return memoryStorage;
  },
};

const memoryStorage = createMemoryStorage();
