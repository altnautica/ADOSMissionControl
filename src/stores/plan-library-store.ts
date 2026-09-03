/**
 * @module plan-library-store
 * @description Zustand store for flight plan library. Persisted to IndexedDB.
 * Owns saved plans, folders, active plan tracking, dirty detection, and UI state.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { SavedPlan, PlanMetadata, PlanFolder, Waypoint } from "@/lib/types";
import type { GeofenceSnapshot } from "@/stores/geofence-store";
import type { RallyPoint } from "@/stores/rally-store";
import type { PointOfInterest } from "@/stores/plan-poi-store";
import { indexedDBStorage } from "@/lib/storage";
import { foldLegacyWaypoints } from "@/lib/mission/mission-expand";
import { planSnapshotString } from "@/lib/plan-snapshot";

/** Fence + rally + POI geometry captured alongside a plan's waypoints on save. */
export interface PlanExtras {
  geofence?: GeofenceSnapshot;
  rally?: RallyPoint[];
  pois?: PointOfInterest[];
}

/**
 * Migrate a persisted plan-library payload forward. Exported so the migration
 * branches are unit-testable in isolation.
 *
 * - v2 added optional `geofence`/`rally` on each SavedPlan.
 * - v3 added optional `pois` on each SavedPlan.
 * - v4 nests action commands under their navigation waypoint (per-waypoint
 *   `actions[]`), so each saved plan's legacy flat waypoint list is folded.
 *
 * The v2/v3 fields are optional, so a pre-migration plan simply reads them as
 * `undefined` with no transform. v4 is the first branch that rewrites data.
 */
export function migratePlanLibrary(
  persisted: unknown,
  version: number,
): PlanLibraryState {
  const state = persisted as PlanLibraryState;
  if (version < 3) {
    // v3: `pois` is optional on SavedPlan, so pre-v3 plans read it as
    // `undefined`. No per-plan transform needed — the branch documents the
    // schema bump and is the seam for any future non-trivial POI migration.
  }
  if (version < 4) {
    // v4: fold each saved plan's legacy flat waypoint list (where DO_/CONDITION_
    // commands were their own top-level rows) into the per-waypoint action model.
    if (Array.isArray(state.plans)) {
      state.plans = state.plans.map((plan) =>
        Array.isArray(plan.waypoints)
          ? { ...plan, waypoints: foldLegacyWaypoints(plan.waypoints) }
          : plan,
      );
    }
  }
  return state;
}

interface PlanLibraryState {
  plans: SavedPlan[];
  folders: PlanFolder[];
  activePlanId: string | null;
  isDirty: boolean;
  libraryCollapsed: boolean;
  searchQuery: string;
  sortBy: "name" | "date" | "waypoints";
  sortDirection: "asc" | "desc";
  expandedFolders: string[];
  savedSnapshot: string;

  // Plan CRUD
  createPlan: (name?: string, waypoints?: Waypoint[], metadata?: PlanMetadata, extras?: PlanExtras) => string;
  savePlan: (id: string, waypoints: Waypoint[], metadata?: Partial<PlanMetadata>, extras?: PlanExtras) => void;
  updatePlanName: (id: string, name: string) => void;
  deletePlan: (id: string) => void;
  duplicatePlan: (id: string) => string | null;
  movePlan: (id: string, folderId: string | null) => void;

  // Folder CRUD
  createFolder: (name: string, parentId?: string | null) => string;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;

  // Active plan
  setActivePlan: (id: string | null) => void;
  setDirty: (dirty: boolean) => void;
  setSavedSnapshot: (snapshot: string) => void;

  // UI
  toggleLibrary: () => void;
  setLibraryCollapsed: (collapsed: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSortBy: (sort: "name" | "date" | "waypoints") => void;
  toggleSortDirection: () => void;
  toggleFolder: (id: string) => void;
}

function genId(): string {
  return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

export const usePlanLibraryStore = create<PlanLibraryState>()(
  persist(
    (set, get) => ({
      plans: [],
      folders: [],
      activePlanId: null,
      isDirty: false,
      libraryCollapsed: false,
      searchQuery: "",
      sortBy: "date",
      sortDirection: "desc",
      expandedFolders: [],
      savedSnapshot: "",

      createPlan: (name, waypoints, metadata, extras) => {
        const id = genId();
        const now = Date.now();
        const plan: SavedPlan = {
          id,
          name: name || "Untitled Plan",
          folderId: null,
          waypoints: waypoints || [],
          metadata: metadata || {},
          geofence: extras?.geofence,
          rally: extras?.rally,
          pois: extras?.pois,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          plans: [plan, ...s.plans],
          activePlanId: id,
          isDirty: false,
          savedSnapshot: planSnapshotString(waypoints || [], extras),
        }));
        return id;
      },

      savePlan: (id, waypoints, metadata, extras) => {
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id
              ? {
                  ...p,
                  waypoints,
                  metadata: metadata ? { ...p.metadata, ...metadata } : p.metadata,
                  // Only overwrite fence/rally/poi when a capture was passed, so
                  // a waypoints-only save never wipes them.
                  geofence: extras ? extras.geofence : p.geofence,
                  rally: extras ? extras.rally : p.rally,
                  pois: extras ? extras.pois : p.pois,
                  updatedAt: Date.now(),
                }
              : p
          ),
          isDirty: false,
          savedSnapshot: planSnapshotString(waypoints, extras),
        }));
      },

      updatePlanName: (id, name) => {
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id ? { ...p, name, updatedAt: Date.now() } : p
          ),
        }));
      },

      deletePlan: (id) => {
        set((s) => ({
          plans: s.plans.filter((p) => p.id !== id),
          activePlanId: s.activePlanId === id ? null : s.activePlanId,
          isDirty: s.activePlanId === id ? false : s.isDirty,
        }));
      },

      duplicatePlan: (id) => {
        const { plans } = get();
        const source = plans.find((p) => p.id === id);
        if (!source) return null;
        const newId = genId();
        const now = Date.now();
        const dup: SavedPlan = {
          ...source,
          id: newId,
          name: `${source.name} (copy)`,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ plans: [dup, ...s.plans] }));
        return newId;
      },

      movePlan: (id, folderId) => {
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === id ? { ...p, folderId, updatedAt: Date.now() } : p
          ),
        }));
      },

      createFolder: (name, parentId) => {
        const id = genId();
        const folder: PlanFolder = {
          id,
          name,
          parentId: parentId ?? null,
          createdAt: Date.now(),
          order: get().folders.length,
        };
        set((s) => ({ folders: [...s.folders, folder] }));
        return id;
      },

      renameFolder: (id, name) => {
        set((s) => ({
          folders: s.folders.map((f) => (f.id === id ? { ...f, name } : f)),
        }));
      },

      deleteFolder: (id) => {
        set((s) => ({
          folders: s.folders.filter((f) => f.id !== id),
          plans: s.plans.map((p) =>
            p.folderId === id ? { ...p, folderId: null } : p
          ),
        }));
      },

      setActivePlan: (id) => set({ activePlanId: id, isDirty: false }),
      setDirty: (isDirty) => set({ isDirty }),
      setSavedSnapshot: (savedSnapshot) => set({ savedSnapshot }),

      toggleLibrary: () => set((s) => ({ libraryCollapsed: !s.libraryCollapsed })),
      setLibraryCollapsed: (libraryCollapsed) => set({ libraryCollapsed }),
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      setSortBy: (sortBy) => set({ sortBy }),
      toggleSortDirection: () =>
        set((s) => ({ sortDirection: s.sortDirection === "asc" ? "desc" : "asc" })),
      toggleFolder: (id) =>
        set((s) => ({
          expandedFolders: s.expandedFolders.includes(id)
            ? s.expandedFolders.filter((f) => f !== id)
            : [...s.expandedFolders, id],
        })),
    }),
    {
      name: "altcmd:plan-library",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 4,
      partialize: (state) => ({
        plans: state.plans,
        folders: state.folders,
        activePlanId: state.activePlanId,
        libraryCollapsed: state.libraryCollapsed,
        sortBy: state.sortBy,
        sortDirection: state.sortDirection,
        expandedFolders: state.expandedFolders,
      }),
      migrate: (persisted, version) => migratePlanLibrary(persisted, version),
    }
  )
);
