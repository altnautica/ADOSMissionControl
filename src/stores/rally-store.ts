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
import { useUploadReceiptsStore, contentHash } from "./upload-receipts-store";

export interface RallyPoint {
  id: string;
  lat: number;
  lon: number;
  alt: number; // meters
}

/** Outcome of a rally transfer, with the reason on failure. */
export interface RallyTransferResult {
  success: boolean;
  message: string;
}

/** Hash of the rally content an upload sends (ids are local handles). */
export function rallyContentHash(points: readonly RallyPoint[]): string {
  return contentHash(points.map((p) => [p.lat, p.lon, p.alt]));
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
  /** Upload every point to the selected drone and report what the FC
   *  acknowledged; never resolves success for an unconfirmed upload. */
  uploadRallyPoints: () => Promise<RallyTransferResult>;
  /**
   * Replace the local points with the selected drone's. A failed, disconnected
   * or unsupported download leaves the local points untouched.
   * `beforeReplace` runs just before the replacement (the caller records the
   * undo step there, so a failed download adds none).
   */
  downloadRallyPoints: (beforeReplace?: () => void) => Promise<RallyTransferResult>;

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
    const { drones, selectedDroneId } = useDroneManager.getState();
    const protocol = selectedDroneId ? drones.get(selectedDroneId)?.protocol : undefined;
    if (!protocol || !selectedDroneId) return { success: false, message: "No flight controller connected" };
    if (!protocol.uploadRallyPoints) {
      return { success: false, message: "This flight controller does not support rally points" };
    }
    const { points } = get();
    if (points.length === 0) return { success: false, message: "No rally points to upload" };
    const hash = rallyContentHash(points);
    let result: RallyTransferResult;
    try {
      const r = await protocol.uploadRallyPoints(
        points.map((p) => ({ lat: p.lat, lon: p.lon, alt: p.alt })),
      );
      result = { success: r.success, message: r.message };
    } catch (err) {
      result = { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    const receipts = useUploadReceiptsStore.getState();
    if (result.success) {
      receipts.record("rally", { droneId: selectedDroneId, contentHash: hash, at: Date.now() });
    } else {
      // A partial transfer leaves the FC's rally list unknown.
      receipts.clearKindForDrone("rally", selectedDroneId);
    }
    return result;
  },

  downloadRallyPoints: async (beforeReplace) => {
    const { drones, selectedDroneId } = useDroneManager.getState();
    const protocol = selectedDroneId ? drones.get(selectedDroneId)?.protocol : undefined;
    if (!protocol || !selectedDroneId) return { success: false, message: "No flight controller connected" };
    if (!protocol.downloadRallyPoints) {
      return { success: false, message: "This flight controller does not support rally points" };
    }
    let downloaded: Array<{ lat: number; lon: number; alt: number }>;
    try {
      downloaded = await protocol.downloadRallyPoints();
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    beforeReplace?.();
    const points = downloaded.map((p, i) => ({
      id: `rally-${Date.now()}-${i}`,
      lat: p.lat,
      lon: p.lon,
      alt: p.alt,
    }));
    set({ points });
    useUploadReceiptsStore.getState().record("rally", {
      droneId: selectedDroneId,
      contentHash: rallyContentHash(points),
      at: Date.now(),
    });
    return { success: true, message: `Loaded ${points.length} rally points` };
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
