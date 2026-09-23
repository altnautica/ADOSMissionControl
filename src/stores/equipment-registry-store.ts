/**
 * Equipment registry — props / motors / ESCs / cameras / gimbals / payloads
 * / frames / RC transmitters.
 *
 * Data model + IDB persistence + edit API. The `recordFlight` mutation is
 * exported and ready, but no caller wires it yet (the loadout linkage on the
 * Command tab does that downstream).
 *
 * @module stores/equipment-registry-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { EquipmentItem, EquipmentType } from "@/lib/types/operator";
import { createIdbStoreLoader } from "@/lib/idb-store-loader";

const IDB_KEY = "altcmd:equipment-registry";

interface State {
  items: Record<string, EquipmentItem>;
}

interface Actions {
  upsert: (item: EquipmentItem) => void;
  update: (id: string, patch: Partial<EquipmentItem>) => void;
  remove: (id: string) => void;
  get: (id: string) => EquipmentItem | undefined;
  /** All known items including retired. Sorted by type then label. */
  listAll: () => EquipmentItem[];
  /** Active (non-retired) items. */
  listActive: () => EquipmentItem[];
  /** Active items filtered to a single equipment type. */
  listByType: (type: EquipmentType) => EquipmentItem[];
  /** True if `totalFlightHours >= inspectionDueHours`. */
  isInspectionDue: (id: string) => boolean;
  /**
   * Increment usage stats. Called by the loadout linkage after a flight finalizes
   * with this item in its loadout.
   */
  recordFlight: (id: string, flightSeconds: number) => void;
  /** Mark inspected. Resets the "due" badge by updating `lastInspectedAt`. */
  markInspected: (id: string, isoDate?: string) => void;
  /** Mark retired with the given ISO date (defaults to today). */
  retire: (id: string, isoDate?: string) => void;
  /** Async: read the persisted items once and merge them into memory. Idempotent. */
  ensureLoaded: () => Promise<void>;
  /** Async: write current items to IndexedDB, after the load completes. */
  persistToIDB: () => Promise<void>;
}

function compareItems(a: EquipmentItem, b: EquipmentItem): number {
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return a.label.localeCompare(b.label);
}

export const useEquipmentRegistryStore = create<State & Actions>((set, getState) => ({
  items: {},

  upsert: (item) => {
    set((s) => ({ items: { ...s.items, [item.id]: item } }));
    void getState().persistToIDB();
  },

  update: (id, patch) => {
    set((s) => {
      const existing = s.items[id];
      if (!existing) return s;
      return { items: { ...s.items, [id]: { ...existing, ...patch } } };
    });
    void getState().persistToIDB();
  },

  remove: (id) => {
    set((s) => {
      const next = { ...s.items };
      delete next[id];
      return { items: next };
    });
    void getState().persistToIDB();
  },

  get: (id) => getState().items[id],

  listAll: () => Object.values(getState().items).sort(compareItems),

  listActive: () =>
    Object.values(getState().items)
      .filter((i) => !i.retiredAt)
      .sort(compareItems),

  listByType: (type) =>
    Object.values(getState().items)
      .filter((i) => !i.retiredAt && i.type === type)
      .sort((a, b) => a.label.localeCompare(b.label)),

  isInspectionDue: (id) => {
    const item = getState().items[id];
    if (!item || item.inspectionDueHours === undefined) return false;
    return (item.totalFlightHours ?? 0) >= item.inspectionDueHours;
  },

  recordFlight: (id, flightSeconds) => {
    set((s) => {
      const existing = s.items[id];
      if (!existing) return s;
      const hours = (existing.totalFlightHours ?? 0) + flightSeconds / 3600;
      const flights = (existing.totalFlights ?? 0) + 1;
      return {
        items: {
          ...s.items,
          [id]: {
            ...existing,
            totalFlightHours: Math.round(hours * 100) / 100,
            totalFlights: flights,
          },
        },
      };
    });
    void getState().persistToIDB();
  },

  markInspected: (id, isoDate) => {
    const date = isoDate ?? new Date().toISOString().slice(0, 10);
    set((s) => {
      const existing = s.items[id];
      if (!existing) return s;
      return { items: { ...s.items, [id]: { ...existing, lastInspectedAt: date } } };
    });
    void getState().persistToIDB();
  },

  retire: (id, isoDate) => {
    const date = isoDate ?? new Date().toISOString().slice(0, 10);
    set((s) => {
      const existing = s.items[id];
      if (!existing) return s;
      return { items: { ...s.items, [id]: { ...existing, retiredAt: date } } };
    });
    void getState().persistToIDB();
  },

  ensureLoaded: () => idb.ensureLoaded(),

  persistToIDB: () => idb.persist(() => idbSet(IDB_KEY, getState().items)),
}));

const idb = createIdbStoreLoader("equipment-registry-store", async () => {
  const stored = (await idbGet(IDB_KEY)) as Record<string, EquipmentItem> | undefined;
  if (stored && typeof stored === "object") {
    useEquipmentRegistryStore.setState((s) => ({ items: { ...s.items, ...stored } }));
  }
});
