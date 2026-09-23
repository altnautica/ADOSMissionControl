/**
 * Load-once gate for Zustand stores that mirror a whole value into IndexedDB.
 *
 * Those stores write the full in-memory value on every persist, so a write
 * issued before the stored value has been read would replace everything on
 * disk with whatever happens to be in memory. The loader makes that
 * impossible: `persist` always waits for the load (which merges the stored
 * value into memory) and refuses to write while the store is not loaded.
 *
 * `ensureLoaded` is idempotent and shares one in-flight promise. It never
 * rejects: a failed read logs, leaves the store unloaded, and is retried by
 * the next `ensureLoaded` or `persist` call.
 *
 * @module lib/idb-store-loader
 * @license GPL-3.0-only
 */

export interface IdbStoreLoader {
  /** Read and merge the stored value once. Safe to call from anywhere. */
  ensureLoaded: () => Promise<void>;
  /** True once the stored value has been read and merged into memory. */
  isLoaded: () => boolean;
  /**
   * Wait for the load, then run `write`. Skips the write while the store
   * could not be loaded, so an unread value on disk is never replaced.
   */
  persist: (write: () => Promise<unknown>) => Promise<void>;
}

export function createIdbStoreLoader(
  label: string,
  load: () => Promise<void>,
): IdbStoreLoader {
  let loaded = false;
  let inFlight: Promise<void> | null = null;

  const ensureLoaded = (): Promise<void> => {
    if (loaded) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = load()
      .then(() => {
        loaded = true;
      })
      .catch((err: unknown) => {
        console.warn(`[${label}] load from IndexedDB failed`, err);
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return {
    ensureLoaded,
    isLoaded: () => loaded,
    persist: async (write) => {
      await ensureLoaded();
      if (!loaded) {
        console.warn(`[${label}] write skipped: stored value not loaded`);
        return;
      }
      try {
        await write();
      } catch (err) {
        console.warn(`[${label}] write to IndexedDB failed`, err);
      }
    },
  };
}
