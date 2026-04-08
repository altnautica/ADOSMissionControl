/**
 * Battery registry — per-pack metadata + cycle tracking.
 *
 * Phase 12a — data model + IDB persistence + edit API. The `recordCycle`
 * mutation is exported and ready, but no caller wires it yet (Phase 12c
 * does that via the loadout linkage on the Command tab).
 *
 * @module stores/battery-registry-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { BatteryPack } from "@/lib/types/operator";

const IDB_KEY = "altcmd:battery-registry";

/**
 * Cycle-based linear health degradation model. LiPo packs typically lose
 * ~0.04% per cycle in light use, ~0.08% in heavy use. We use 0.05% as a
 * conservative middle ground; operators can override the per-pack
 * `healthPercent` manually.
 */
const HEALTH_LOSS_PER_CYCLE_PCT = 0.05;

interface State {
  packs: Record<string, BatteryPack>;
  _loadedFromIdb: boolean;
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
   * Increment a pack's cycle count and decay its health estimate.
   * Called by Phase 12c after a flight finalizes with this pack in its loadout.
   */
  recordCycle: (id: string) => void;
  /** Mark a pack retired with the given ISO date (defaults to today). */
  retire: (id: string, isoDate?: string) => void;
  loadFromIDB: () => Promise<void>;
  persistToIDB: () => Promise<void>;
}

export const useBatteryRegistryStore = create<State & Actions>((set, getState) => ({
  packs: {},
  _loadedFromIdb: false,

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
      const cycles = (existing.cycleCount ?? 0) + 1;
      // Project health from initial 100% minus cycle decay.
      const projectedHealth = Math.max(0, 100 - cycles * HEALTH_LOSS_PER_CYCLE_PCT);
      const next: BatteryPack = {
        ...existing,
        cycleCount: cycles,
        healthPercent: existing.healthPercent ?? projectedHealth,
      };
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

  loadFromIDB: async () => {
    if (getState()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_KEY)) as Record<string, BatteryPack> | undefined;
      if (stored && typeof stored === "object") {
        set({ packs: stored, _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[battery-registry-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      await idbSet(IDB_KEY, getState().packs);
    } catch (err) {
      console.warn("[battery-registry-store] persistToIDB failed", err);
    }
  },
}));
