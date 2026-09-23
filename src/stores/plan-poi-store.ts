/**
 * @module plan-poi-store
 * @description Zustand store for plan-attached Points of Interest (POIs).
 *
 * A POI here is a pure GCS PLANNING ANNOTATION — a labelled map marker with a
 * lat/lon and an optional note. Unlike rally points, a POI is NOT an FC /
 * MAVLink concept, so there is no protocol upload/download: POIs only render on
 * the planner map and save/load alongside a plan (see `plan-workspace`). The
 * store shape mirrors {@link module:rally-store} so the map, editor, undo
 * timeline, and plan round-trip all follow the same proven pattern.
 *
 * NOTE: distinct from the live flight-map marker store (`poi-store` /
 * `usePoiStore`), which is a separate, localStorage-persisted flight-view
 * feature. This one is transient and rides on a SavedPlan.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import { withPlannerHistory } from "@/lib/planner-history-adapter";

export interface PointOfInterest {
  id: string;
  lat: number;
  lon: number;
  /** Operator-chosen label shown next to the marker. Optional. */
  label?: string;
  /** Free-form note. Optional. */
  note?: string;
}

/**
 * Immutable snapshot of POI state for the coordinated planner undo timeline.
 * Carries the current selection so an undo/redo restores the exact prior state.
 */
export interface PoiSnapshot {
  points: PointOfInterest[];
  selectedId: string | null;
}

interface PlanPoiStoreState {
  points: PointOfInterest[];
  /** ID of the POI selected in the editor / on the map, or null. */
  selectedId: string | null;
  /** Point edits are operator-facing: each one is a planner undo step. */
  addPoint: (point: PointOfInterest) => void;
  removePoint: (id: string) => void;
  updatePoint: (id: string, update: Partial<PointOfInterest>) => void;
  /** Select a POI (or clear the selection with null). */
  select: (id: string | null) => void;
  clearPoints: () => void;

  /** Capture POI state for the coordinated undo timeline. */
  snapshot: () => PoiSnapshot;
  /** Restore a previously captured POI state (from undo / redo, or a plan load). */
  restore: (snap: PoiSnapshot) => void;
}

export const usePlanPoiStore = create<PlanPoiStoreState>()((set, get) => ({
  points: [],
  selectedId: null,

  addPoint: (point) => withPlannerHistory(() => set((s) => ({ points: [...s.points, point] }))),

  removePoint: (id) =>
    withPlannerHistory(() =>
      set((s) => ({
        points: s.points.filter((p) => p.id !== id),
        // Drop the selection when the selected point is the one being removed.
        selectedId: s.selectedId === id ? null : s.selectedId,
      })),
    ),

  updatePoint: (id, update) =>
    withPlannerHistory(() =>
      set((s) => ({
        points: s.points.map((p) => (p.id === id ? { ...p, ...update } : p)),
      })),
    ),

  select: (selectedId) => set({ selectedId }),

  clearPoints: () => withPlannerHistory(() => set({ points: [], selectedId: null })),

  snapshot: () => ({
    // Copy each point so a later mutation can never alias a stored snapshot.
    points: get().points.map((p) => ({ ...p })),
    selectedId: get().selectedId,
  }),

  restore: (snap) =>
    set({
      points: snap.points.map((p) => ({ ...p })),
      selectedId: snap.selectedId,
    }),
}));
