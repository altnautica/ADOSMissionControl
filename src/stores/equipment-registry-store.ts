/**
 * Equipment registry — props / motors / ESCs / cameras / gimbals / payloads
 * / frames / RC transmitters.
 *
 * Phase 12b — data model + IDB persistence + edit API. The `recordFlight`
 * mutation is exported and ready, but no caller wires it yet (Phase 12c
 * does that via the loadout linkage on the Command tab).
 *
 * @module stores/equipment-registry-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { EquipmentItem, EquipmentType } from "@/lib/types/operator";

const IDB_KEY = "altcmd:equipment-registry";

interface State {
  items: Record<string, EquipmentItem>;
  _loadedFromIdb: boolean;
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
   * Increment usage stats. Called by Phase 12c after a flight finalizes
   * with this item in its loadout.
   */
  recordFlight: (id: string, flightSeconds: number) => void;
  /** Mark inspected. Resets the "due" badge by updating `lastInspectedAt`. */
  markInspected: (id: string, isoDate?: string) => void;
  /** Mark retired with the given ISO date (defaults to today). */
  retire: (id: string, isoDate?: string) => void;
  loadFromIDB: () => Promise<void>;
  persistToIDB: () => Promise<void>;
}

function compareItems(a: EquipmentItem, b: EquipmentItem): number {
  if (a.type !== b.type) return a.type.localeCompare(b.type);
  return a.label.localeCompare(b.label);
}

export const useEquipmentRegistryStore = create<State & Actions>((set, getState) => ({
  items: {},
  _loadedFromIdb: false,

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

  loadFromIDB: async () => {
    if (getState()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_KEY)) as Record<string, EquipmentItem> | undefined;
      if (stored && typeof stored === "object") {
        set({ items: stored, _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[equipment-registry-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      await idbSet(IDB_KEY, getState().items);
    } catch (err) {
      console.warn("[equipment-registry-store] persistToIDB failed", err);
    }
  },
}));
