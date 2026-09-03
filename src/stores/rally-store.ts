/**
 * @module rally-store
 * @description Zustand store for rally (safe return) point management.
 * Rally points are alternate landing locations that the FC can use during failsafe.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";
import { useDroneManager } from "./drone-manager";

export interface RallyPoint {
  id: string;
  lat: number;
  lon: number;
  alt: number; // meters
}

/**
 * Immutable snapshot of rally state for the coordinated planner undo timeline.
 */
export interface RallySnapshot {
  points: RallyPoint[];
}

interface RallyStoreState {
  points: RallyPoint[];
  addPoint: (point: RallyPoint) => void;
  removePoint: (id: string) => void;
  updatePoint: (id: string, update: Partial<RallyPoint>) => void;
  clearPoints: () => void;
  uploadRallyPoints: () => Promise<void>;
  downloadRallyPoints: () => Promise<void>;

  /** Capture rally state for the coordinated undo timeline. */
  snapshot: () => RallySnapshot;
  /** Restore a previously captured rally state (from undo / redo). */
  restore: (snap: RallySnapshot) => void;
}

export const useRallyStore = create<RallyStoreState>()(
  persist(
    (set, get) => ({
  points: [],

  addPoint: (point) =>
    set((s) => ({ points: [...s.points, point] })),

  removePoint: (id) =>
    set((s) => ({ points: s.points.filter((p) => p.id !== id) })),

  updatePoint: (id, update) =>
    set((s) => ({
      points: s.points.map((p) => (p.id === id ? { ...p, ...update } : p)),
    })),

  clearPoints: () => set({ points: [] }),

  uploadRallyPoints: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol?.uploadRallyPoints) return;
    const { points } = get();
    if (points.length === 0) return;
    await protocol.uploadRallyPoints(
      points.map((p) => ({ lat: p.lat, lon: p.lon, alt: p.alt })),
    );
  },

  downloadRallyPoints: async () => {
    const protocol = useDroneManager.getState().getSelectedProtocol();
    if (!protocol?.downloadRallyPoints) return;
    const downloaded = await protocol.downloadRallyPoints();
    set({
      points: downloaded.map((p, i) => ({
        id: `rally-${Date.now()}-${i}`,
        lat: p.lat,
        lon: p.lon,
        alt: p.alt,
      })),
    });
  },

  snapshot: () => ({
    // Copy each point so a later mutation can never alias a stored snapshot.
    points: get().points.map((p) => ({ ...p })),
  }),

  restore: (snap) =>
    set({ points: snap.points.map((p) => ({ ...p })) }),
    }),
    {
      name: "altcmd:rally-store",
      storage: createJSONStorage(indexedDBStorage.storage),
      version: 1,
      // Only the operator-placed points persist; upload/download state is FC-driven.
      partialize: (state) => ({ points: state.points }),
      migrate: (persisted, version) => {
        const state = persisted as Record<string, unknown>;
        if (version < 1 || !Array.isArray(state.points)) {
          // v1 is the first persisted version; anything older carried no rally
          // geometry, so start empty rather than inventing return points.
          state.points = [];
        }
        return state as unknown as RallyStoreState;
      },
    },
  ),
);
