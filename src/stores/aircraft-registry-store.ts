/**
 * Aircraft registry — per-drone hardware + airworthiness records.
 *
 * Keyed by `id` which equals the drone-manager droneId. Auto-seeded the first
 * time a drone connects via `getOrCreate(droneId, droneName)`. Persisted to
 * IndexedDB under `altcmd:aircraft-registry`.
 *
 * @module stores/aircraft-registry-store
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { get as idbGet, set as idbSet } from "idb-keyval";
import type { AircraftRecord } from "@/lib/types/operator";

const IDB_KEY = "altcmd:aircraft-registry";

interface State {
  /** Plain object map keyed by drone id (Zustand-friendlier than Map). */
  aircraft: Record<string, AircraftRecord>;
  _loadedFromIdb: boolean;
}

interface Actions {
  /** Insert or replace an aircraft record. */
  upsert: (record: AircraftRecord) => void;
  /** Patch a subset of fields. Noop if id missing. */
  update: (id: string, patch: Partial<AircraftRecord>) => void;
  /** Remove an aircraft record. */
  remove: (id: string) => void;
  /** Read an aircraft record. */
  get: (id: string) => AircraftRecord | undefined;
  /**
   * Return the existing record for {@link droneId}, or seed a minimal one
   * with the given name and persist it. Used by flight-lifecycle on arm so
   * brand-new drones automatically get a registry entry.
   */
  getOrCreate: (droneId: string, droneName: string) => AircraftRecord;
  /** Increment usage stats. Called by flight-lifecycle on disarm. */
  recordFlight: (droneId: string, flightSeconds: number) => void;
  /** Async: load persisted registry from IndexedDB. Idempotent. */
  loadFromIDB: () => Promise<void>;
  /** Async: write current registry to IndexedDB. */
  persistToIDB: () => Promise<void>;
}

export const useAircraftRegistryStore = create<State & Actions>((set, getState) => ({
  aircraft: {},
  _loadedFromIdb: false,

  upsert: (record) => {
    set((s) => ({ aircraft: { ...s.aircraft, [record.id]: record } }));
    void getState().persistToIDB();
  },

  update: (id, patch) => {
    set((s) => {
      const existing = s.aircraft[id];
      if (!existing) return s;
      return { aircraft: { ...s.aircraft, [id]: { ...existing, ...patch } } };
    });
    void getState().persistToIDB();
  },

  remove: (id) => {
    set((s) => {
      const next = { ...s.aircraft };
      delete next[id];
      return { aircraft: next };
    });
    void getState().persistToIDB();
  },

  get: (id) => getState().aircraft[id],

  getOrCreate: (droneId, droneName) => {
    const existing = getState().aircraft[droneId];
    if (existing) return existing;
    const fresh: AircraftRecord = {
      id: droneId,
      name: droneName,
      vehicleType: "copter",
      totalFlightHours: 0,
      totalFlights: 0,
    };
    set((s) => ({ aircraft: { ...s.aircraft, [droneId]: fresh } }));
    void getState().persistToIDB();
    return fresh;
  },

  recordFlight: (droneId, flightSeconds) => {
    set((s) => {
      const existing = s.aircraft[droneId];
      if (!existing) return s;
      const hours = (existing.totalFlightHours ?? 0) + flightSeconds / 3600;
      const flights = (existing.totalFlights ?? 0) + 1;
      return {
        aircraft: {
          ...s.aircraft,
          [droneId]: {
            ...existing,
            totalFlightHours: Math.round(hours * 100) / 100,
            totalFlights: flights,
          },
        },
      };
    });
    void getState().persistToIDB();
  },

  loadFromIDB: async () => {
    if (getState()._loadedFromIdb) return;
    try {
      const stored = (await idbGet(IDB_KEY)) as Record<string, AircraftRecord> | undefined;
      if (stored && typeof stored === "object") {
        set({ aircraft: stored, _loadedFromIdb: true });
      } else {
        set({ _loadedFromIdb: true });
      }
    } catch (err) {
      console.warn("[aircraft-registry-store] loadFromIDB failed", err);
      set({ _loadedFromIdb: true });
    }
  },

  persistToIDB: async () => {
    try {
      await idbSet(IDB_KEY, getState().aircraft);
    } catch (err) {
      console.warn("[aircraft-registry-store] persistToIDB failed", err);
    }
  },
}));
