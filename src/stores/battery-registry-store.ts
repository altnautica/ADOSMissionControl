/**
 * Battery registry — per-pack metadata + cycle tracking.
 *
 * Data model + IDB persistence + edit API. The `recordCycle` mutation is
 * exported and ready, but no caller wires it yet (the loadout linkage on
 * the Command tab does that downstream).
 *
 * @module stores/battery-registry-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { BatteryPack } from "@/lib/types/operator";
import { createIdbStoreLoader } from "@/lib/idb-store-loader";

const IDB_KEY = "altcmd:battery-registry";


interface State {
  packs: Record<string, BatteryPack>;
}

interface Actions {
  upsert: (pack: BatteryPack) => void;
  update: (id: string, patch: Partial<BatteryPack>) => void;
  remove: (id: string) => void;
  get: (id: string) => BatteryPack | undefined;
  /**
   * List currently in-service packs (excludes retired). Sorted by label.
   */
  listActive: () => BatteryPack[];
  /**
   * List every known pack including retired ones, sorted by label.
   */
  listAll: () => BatteryPack[];
  /**
   * Increment a pack's cycle count; the projected health follows from it.
   * Called by the loadout linkage after a flight finalizes with this pack.
   */
  recordCycle: (id: string) => void;
  /** Mark a pack retired with the given ISO date (defaults to today). */
  retire: (id: string, isoDate?: string) => void;
  /** Async: read the persisted packs once and merge them into memory. Idempotent. */
  ensureLoaded: () => Promise<void>;
  /** Async: write current packs to IndexedDB, after the load completes. */
  persistToIDB: () => Promise<void>;
}

export const useBatteryRegistryStore = create<State & Actions>((set, getState) => ({
  packs: {},

  upsert: (pack) => {
    set((s) => ({ packs: { ...s.packs, [pack.id]: pack } }));
    void getState().persistToIDB();
  },

  update: (id, patch) => {
    set((s) => {
      const existing = s.packs[id];
      if (!existing) return s;
      return { packs: { ...s.packs, [id]: { ...existing, ...patch } } };
    });
    void getState().persistToIDB();
  },

  remove: (id) => {
    set((s) => {
      const next = { ...s.packs };
      delete next[id];
      return { packs: next };
    });
    void getState().persistToIDB();
  },

  get: (id) => getState().packs[id],

  listActive: () =>
    Object.values(getState().packs)
      .filter((p) => !p.retiredAt)
      .sort((a, b) => a.label.localeCompare(b.label)),

  listAll: () =>
    Object.values(getState().packs).sort((a, b) => a.label.localeCompare(b.label)),

  recordCycle: (id) => {
    set((s) => {
      const existing = s.packs[id];
      if (!existing) return s;
      const next: BatteryPack = { ...existing, cycleCount: (existing.cycleCount ?? 0) + 1 };
      return { packs: { ...s.packs, [id]: next } };
    });
    void getState().persistToIDB();
  },

  retire: (id, isoDate) => {
    const date = isoDate ?? new Date().toISOString().slice(0, 10);
    set((s) => {
      const existing = s.packs[id];
      if (!existing) return s;
      return { packs: { ...s.packs, [id]: { ...existing, retiredAt: date } } };
    });
    void getState().persistToIDB();
  },

  ensureLoaded: () => idb.ensureLoaded(),

  persistToIDB: () => idb.persist(() => idbSet(IDB_KEY, getState().packs)),
}));

const idb = createIdbStoreLoader("battery-registry-store", async () => {
  const stored = (await idbGet(IDB_KEY)) as Record<string, BatteryPack> | undefined;
  if (stored && typeof stored === "object") {
    useBatteryRegistryStore.setState((s) => ({ packs: { ...s.packs, ...stored } }));
  }
});
