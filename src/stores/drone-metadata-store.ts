/**
 * @module drone-metadata-store
 * @description Zustand store for persistent drone metadata (identity, vehicle info,
 * stats). Persisted to IndexedDB. These are user-assigned fields that survive
 * page reloads and reconnections.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";

export interface DroneMetadata {
  droneId: string;

  // Identity (editable)
  displayName: string;
  serial: string;
  registration: string;
  notes: string;

  // Vehicle (editable)
  computeModule: string;
  weightClass: string;

  // Stats (partially editable)
  enrolledAt: number;
  totalFlights: number;
  totalHours: number;

  // Video
  /** WHEP endpoint URL for this drone's video feed (empty = no video). */
  videoWhepUrl: string;

  // System
  createdAt: number;
  updatedAt: number;
}

interface DroneMetadataStoreState {
  profiles: Record<string, DroneMetadata>;
  _hasHydrated: boolean;

  /** Get a profile by drone ID. */
  getProfile: (id: string) => DroneMetadata | undefined;
  /** Create or update a profile. */
  upsertProfile: (id: string, partial: Partial<Omit<DroneMetadata, "droneId">>) => void;
  /** Idempotent — creates only if no profile exists for this ID. */
  ensureProfile: (id: string, defaults: Partial<Omit<DroneMetadata, "droneId">>) => void;
  /** Delete a profile. */
  deleteProfile: (id: string) => void;
  /** Check if profile exists. */
  hasProfile: (id: string) => boolean;
}

/**
 * A new profile. Identity and vehicle fields the operator has not entered stay
 * empty so every surface shows "—" rather than a plausible-looking serial,
 * compute module or weight class nobody measured.
 */
function makeDefaults(id: string, partial: Partial<Omit<DroneMetadata, "droneId">>): DroneMetadata {
  const now = Date.now();
  return {
    droneId: id,
    displayName: partial.displayName ?? id,
    serial: partial.serial ?? "",
    registration: partial.registration ?? "",
    notes: partial.notes ?? "",
    computeModule: partial.computeModule ?? "",
    weightClass: partial.weightClass ?? "",
    enrolledAt: partial.enrolledAt ?? now,
    totalFlights: partial.totalFlights ?? 0,
    totalHours: partial.totalHours ?? 0,
    videoWhepUrl: partial.videoWhepUrl ?? "",
    createdAt: partial.createdAt ?? now,
    updatedAt: now,
  };
}

export const useDroneMetadataStore = create<DroneMetadataStoreState>()(
  persist(
    (set, get) => ({
      profiles: {},
      _hasHydrated: false,

      getProfile: (id) => get().profiles[id],

      upsertProfile: (id, partial) =>
        set((state) => {
          const existing = state.profiles[id];
          const updated = existing
            ? { ...existing, ...partial, updatedAt: Date.now() }
            : makeDefaults(id, partial);
          return { profiles: { ...state.profiles, [id]: updated } };
        }),

      ensureProfile: (id, defaults) =>
        set((state) => {
          if (state.profiles[id]) return state;
          return { profiles: { ...state.profiles, [id]: makeDefaults(id, defaults) } };
        }),

      deleteProfile: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.profiles;
          return { profiles: rest };
        }),

      hasProfile: (id) => !!get().profiles[id],
    }),
    {
      name: "altcmd:drone-metadata",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 4,
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // v2: add videoWhepUrl to all existing profiles
          const profiles = state.profiles as Record<string, Record<string, unknown>> | undefined;
          if (profiles) {
            for (const id of Object.keys(profiles)) {
              if (!profiles[id].videoWhepUrl) {
                profiles[id].videoWhepUrl = "";
              }
            }
          }
        }
        if (version < 3) {
          // v3 retired the suite framework. Strip the dropped
          // ``suiteType`` field off each profile so the persisted
          // shape matches the TypeScript interface verbatim.
          const profiles = state.profiles as Record<string, Record<string, unknown>> | undefined;
          if (profiles) {
            for (const id of Object.keys(profiles)) {
              if ("suiteType" in profiles[id]) {
                delete profiles[id].suiteType;
              }
            }
          }
        }
        if (version < 4) {
          // v4: direct-connect sessions (`fc:<random>`, a fresh id on every
          // connect) no longer get a profile, so drop the orphans earlier
          // versions persisted on each connect. Also clear the serial every
          // profile was given as `ALT-<ID>`: it was never a vehicle fact.
          const profiles = state.profiles as Record<string, Record<string, unknown>> | undefined;
          if (profiles) {
            for (const id of Object.keys(profiles)) {
              if (id.startsWith("fc:")) {
                delete profiles[id];
              } else if (profiles[id].serial === `ALT-${id.toUpperCase()}`) {
                profiles[id].serial = "";
              }
            }
          }
        }
        return state as unknown as DroneMetadataStoreState;
      },
      onRehydrateStorage: () => {
        return (state) => {
          if (state) {
            state._hasHydrated = true;
          }
        };
      },
    }
  )
);
