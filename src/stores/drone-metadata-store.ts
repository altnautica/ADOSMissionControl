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
import type { SuiteType } from "@/lib/types";

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
  suiteType: SuiteType | null;

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

function makeDefaults(id: string, partial: Partial<Omit<DroneMetadata, "droneId">>): DroneMetadata {
  const now = Date.now();
  return {
    droneId: id,
    displayName: partial.displayName ?? id,
    serial: partial.serial ?? `ALT-${id.toUpperCase()}`,
    registration: partial.registration ?? "",
    notes: partial.notes ?? "",
    computeModule: partial.computeModule ?? "RPi CM4",
    weightClass: partial.weightClass ?? "Micro",
    suiteType: partial.suiteType ?? null,
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
      version: 2,
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
