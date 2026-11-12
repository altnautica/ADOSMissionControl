/**
 * @module rally-store
 * @description Zustand store for rally (safe return) point management.
 * Rally points are alternate landing locations that the FC can use during failsafe.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { indexedDBStorage } from "@/lib/storage";
import { droneSelection } from "./drone-selection";
import { useUploadReceiptsStore, contentHash } from "./upload-receipts-store";
import { useTelemetryStore } from "./telemetry-store";
import { withPlannerHistory } from "@/lib/planner-history-adapter";
import { flyingMissionRefusal } from "@/lib/mission/upload-guard";
import type { RallyPointItem } from "@/lib/protocol/types";
import {
  MAV_FRAME_GLOBAL, MAV_FRAME_GLOBAL_INT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT, MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_FRAME_GLOBAL_TERRAIN_ALT, MAV_FRAME_GLOBAL_TERRAIN_ALT_INT,
} from "@/lib/mission/altitude-frame";

export interface RallyPoint {
  id: string;
  lat: number;
  lon: number;
  /** Metres above home, or above the terrain below the point with `frame: "terrain"`. */
  alt: number;
  /** `"terrain"`: `alt` is above the terrain below the point. Absent: above home. */
  frame?: "terrain";
}

/** Outcome of a rally transfer, with the reason on failure. */
export interface RallyTransferResult {
  success: boolean;
  message: string;
  /**
   * On a failed transfer: the vehicle's MAV_MISSION_RESULT or a negative
   * GCS-side outcome (see `protocol/mission-result`), for the UI to word.
   */
  resultCode?: number;
}

/** Hash of the rally content an upload sends (ids are local handles). */
export function rallyContentHash(points: readonly RallyPoint[]): string {
  // The frame joins the tuple only when set, so an above-home point hashes as before.
  return contentHash(points.map((p) => (p.frame ? [p.lat, p.lon, p.alt, p.frame] : [p.lat, p.lon, p.alt])));
}

/** The wire items a rally upload sends: each point in its own altitude frame. */
export function rallyUploadItems(points: readonly RallyPoint[]): RallyPointItem[] {
  return points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    alt: p.alt,
    frame: p.frame === "terrain" ? MAV_FRAME_GLOBAL_TERRAIN_ALT : MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  }));
}

/**
 * Convert downloaded rally items into planner points. The planner keeps rally
 * altitudes above home (or above terrain): a point stored above sea level is
 * converted with the home altitude, and refused when no home altitude is
 * known, since showing a sea-level altitude as height above home would make
 * the vehicle climb to it on the next upload.
 */
export function rallyPointsFromVehicle(
  items: readonly RallyPointItem[],
  homeAmsl: number | null,
  idPrefix: string,
): { points: RallyPoint[] } | { error: string } {
  const points: RallyPoint[] = [];
  for (const [i, it] of items.entries()) {
    const base = { id: `${idPrefix}-${i}`, lat: it.lat, lon: it.lon };
    switch (it.frame) {
      case MAV_FRAME_GLOBAL_RELATIVE_ALT:
      case MAV_FRAME_GLOBAL_RELATIVE_ALT_INT:
        points.push({ ...base, alt: it.alt });
        break;
      case MAV_FRAME_GLOBAL_TERRAIN_ALT:
      case MAV_FRAME_GLOBAL_TERRAIN_ALT_INT:
        points.push({ ...base, alt: it.alt, frame: "terrain" });
        break;
      case MAV_FRAME_GLOBAL:
      case MAV_FRAME_GLOBAL_INT:
        if (homeAmsl === null) {
          return { error: `Rally point ${i + 1} is stored above sea level and no home altitude is known` };
        }
        points.push({ ...base, alt: it.alt - homeAmsl });
        break;
      default:
        return { error: `Rally point ${i + 1} uses altitude frame ${it.frame}, which the planner cannot show` };
    }
  }
  return { points };
}

/**
 * Immutable snapshot of rally state for the coordinated planner undo timeline.
 */
export interface RallySnapshot {
  points: RallyPoint[];
}

/** Point edits are operator-facing: each one is a planner undo step. */
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
   * Replace the local points with the selected drone's, as one undo step. A
   * failed, disconnected or unsupported download leaves the local points
   * untouched and records no undo step.
   */
  downloadRallyPoints: () => Promise<RallyTransferResult>;

  /** Capture rally state for the coordinated undo timeline. */
  snapshot: () => RallySnapshot;
  /** Restore a previously captured rally state (from undo / redo). */
  restore: (snap: RallySnapshot) => void;
}

export const useRallyStore = create<RallyStoreState>()(
  persist<RallyStoreState, [], [], Partial<RallyStoreState>>(
    (set, get) => ({
  points: [],

  addPoint: (point) =>
    withPlannerHistory(() => set((s) => ({ points: [...s.points, point] }))),

  removePoint: (id) =>
    withPlannerHistory(() => set((s) => ({ points: s.points.filter((p) => p.id !== id) }))),

  updatePoint: (id, update) =>
    withPlannerHistory(() =>
      set((s) => ({
        points: s.points.map((p) => (p.id === id ? { ...p, ...update } : p)),
      })),
    ),

  clearPoints: () => withPlannerHistory(() => set({ points: [] })),

  uploadRallyPoints: async () => {
    const { drones, selectedDroneId } = droneSelection();
    const protocol = selectedDroneId ? drones.get(selectedDroneId)?.protocol : undefined;
    if (!protocol || !selectedDroneId) return { success: false, message: "No flight controller connected" };
    if (!protocol.uploadRallyPoints) {
      return { success: false, message: "This flight controller does not support rally points" };
    }
    const refusal = flyingMissionRefusal(selectedDroneId);
    if (refusal) return { success: false, message: refusal };
    const { points } = get();
    if (points.length === 0) return { success: false, message: "No rally points to upload" };
    const hash = rallyContentHash(points);
    let result: RallyTransferResult;
    try {
      const r = await protocol.uploadRallyPoints(rallyUploadItems(points));
      result = r.success
        ? { success: true, message: r.message }
        : { success: false, message: r.message, resultCode: r.resultCode };
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

  downloadRallyPoints: async () => {
    const { drones, selectedDroneId } = droneSelection();
    const protocol = selectedDroneId ? drones.get(selectedDroneId)?.protocol : undefined;
    if (!protocol || !selectedDroneId) return { success: false, message: "No flight controller connected" };
    if (!protocol.downloadRallyPoints) {
      return { success: false, message: "This flight controller does not support rally points" };
    }
    let downloaded: RallyPointItem[];
    try {
      downloaded = await protocol.downloadRallyPoints();
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    }
    const homeAmsl = useTelemetryStore.getState().homePosition.latest()?.alt ?? null;
    const converted = rallyPointsFromVehicle(downloaded, homeAmsl, `rally-${Date.now()}`);
    if ("error" in converted) return { success: false, message: converted.error };
    const { points } = converted;
    withPlannerHistory(() => set({ points }));
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
        return state as Partial<RallyStoreState>;
      },
    },
  ),
);
