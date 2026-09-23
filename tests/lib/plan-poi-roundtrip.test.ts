/**
 * Proves the plan-attached POI lifecycle:
 *  - capturePlanExtras -> createPlan -> applyPlanToWorkspace is LOSSLESS.
 *  - a plan with no POIs clears the store on load.
 *  - the v2 -> v3 plan-library migration leaves old (POI-less) plans intact.
 *  - a POI placement is undoable/redoable on the shared planner timeline.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// The domain stores pull in drone-manager; stub it so no real protocol is hit.
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => null }),
    setState: vi.fn(),
  },
}));
// planner-store is only touched via requestFit() during a plan load, and
// mission-store reads defaultFrame for new-waypoint defaults.
vi.mock("@/stores/planner-store", () => ({
  usePlannerStore: {
    getState: () => ({ defaultFrame: "relative", requestFit: vi.fn() }),
    setState: vi.fn(),
  },
}));
vi.mock("@/lib/storage", () => ({
  indexedDBStorage: {
    storage: () => ({
      getItem: vi.fn().mockResolvedValue(null),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// Importing mission-store registers the waypoint adapter (needed for the shared
// undo timeline to span waypoints alongside POIs).
import { useMissionStore } from "@/stores/mission-store";
import { useGeofenceStore } from "@/stores/geofence-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanPoiStore, type PointOfInterest } from "@/stores/plan-poi-store";
import { useDrawingStore } from "@/stores/drawing-store";
import {
  usePlanLibraryStore,
  migratePlanLibrary,
} from "@/stores/plan-library-store";
import { capturePlanExtras, applyPlanToWorkspace } from "@/lib/plan-workspace";
import { clearHistory } from "@/lib/planner-history";
import type { SavedPlan } from "@/lib/types";

function poi(overrides: Partial<PointOfInterest> = {}): PointOfInterest {
  return { id: Math.random().toString(36).slice(2, 10), lat: 12.97, lon: 77.59, ...overrides };
}

function resetAll() {
  useMissionStore.setState({
    activeMission: null,
    waypoints: [],
    progress: 0,
    currentWaypoint: 0,
    uploadState: "idle",
    downloadState: "idle",
  });
  useGeofenceStore.getState().clearFence();
  useRallyStore.getState().clearPoints();
  usePlanPoiStore.setState({ points: [], selectedId: null });
  useDrawingStore.getState().clearAll();
  usePlanLibraryStore.setState({ plans: [], folders: [], activePlanId: null, isDirty: false });
  clearHistory();
}

describe("plan-attached POIs", () => {
  beforeEach(resetAll);

  it("round-trips POIs losslessly through save + load", () => {
    const p1 = poi({ id: "a", label: "Landing zone", note: "hard surface" });
    const p2 = poi({ id: "b", lat: 13.01, lon: 77.7 });
    usePlanPoiStore.setState({ points: [p1, p2], selectedId: "a" });

    // Capture -> the extras carry a deep copy of both POIs.
    const extras = capturePlanExtras();
    expect(extras.pois).toEqual([p1, p2]);

    // Persist onto a plan, then wipe the live store.
    const id = usePlanLibraryStore.getState().createPlan("Test", [], {}, extras);
    usePlanPoiStore.getState().clearPoints();
    expect(usePlanPoiStore.getState().points).toEqual([]);

    const plan = usePlanLibraryStore.getState().plans.find((pl) => pl.id === id);
    expect(plan?.pois).toEqual([p1, p2]);

    // Load the plan back -> the exact same POIs are restored (selection resets).
    applyPlanToWorkspace(plan as SavedPlan);
    expect(usePlanPoiStore.getState().points).toEqual([p1, p2]);
    expect(usePlanPoiStore.getState().selectedId).toBeNull();
  });

  it("omits pois from extras when there are none, and load clears any leftovers", () => {
    const extras = capturePlanExtras();
    expect(extras.pois).toBeUndefined();

    // A stale POI in the store must be cleared when loading a POI-less plan.
    usePlanPoiStore.getState().addPoint(poi({ id: "stale" }));
    const planWithoutPois: SavedPlan = {
      id: "plan-1",
      name: "No POIs",
      folderId: null,
      waypoints: [],
      metadata: {},
      createdAt: 0,
      updatedAt: 0,
    };
    applyPlanToWorkspace(planWithoutPois);
    expect(usePlanPoiStore.getState().points).toEqual([]);
  });

  it("a waypoints-only save preserves previously-captured POIs", () => {
    usePlanPoiStore.setState({ points: [poi({ id: "keep" })], selectedId: null });
    const id = usePlanLibraryStore.getState().createPlan("Test", [], {}, capturePlanExtras());
    // Save without an extras capture must NOT wipe the stored POIs.
    usePlanLibraryStore.getState().savePlan(id, []);
    const plan = usePlanLibraryStore.getState().plans.find((pl) => pl.id === id);
    expect(plan?.pois?.map((p) => p.id)).toEqual(["keep"]);
  });

  it("migratePlanLibrary v2 -> v3 leaves POI-less plans intact", () => {
    const legacy = {
      plans: [
        { id: "x", name: "Old", folderId: null, waypoints: [], metadata: {}, createdAt: 0, updatedAt: 0 },
      ],
      folders: [],
      activePlanId: null,
    };
    const migrated = migratePlanLibrary(legacy, 2);
    expect(migrated.plans[0].pois).toBeUndefined();
    expect(migrated.plans[0].id).toBe("x");
  });

  it("a POI placement is undoable and redoable on the shared timeline", () => {
    usePlanPoiStore.getState().addPoint(poi({ id: "x" }));
    expect(usePlanPoiStore.getState().points).toHaveLength(1);

    useMissionStore.getState().undo();
    expect(usePlanPoiStore.getState().points).toHaveLength(0);

    useMissionStore.getState().redo();
    expect(usePlanPoiStore.getState().points).toHaveLength(1);
    expect(usePlanPoiStore.getState().points[0].id).toBe("x");
  });

  it("a mixed rally + POI sequence undoes step-by-step in reverse", () => {
    useRallyStore.getState().addPoint({ id: "r1", lat: 1, lon: 2, alt: 30 });
    usePlanPoiStore.getState().addPoint(poi({ id: "p1" }));

    expect(useRallyStore.getState().points).toHaveLength(1);
    expect(usePlanPoiStore.getState().points).toHaveLength(1);

    // Undo the POI first — rally remains.
    useMissionStore.getState().undo();
    expect(usePlanPoiStore.getState().points).toHaveLength(0);
    expect(useRallyStore.getState().points).toHaveLength(1);

    // Undo the rally — everything empty.
    useMissionStore.getState().undo();
    expect(useRallyStore.getState().points).toHaveLength(0);
  });
});
