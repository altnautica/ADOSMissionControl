/**
 * Loading a plan starts a fresh undo timeline, and the library's save path
 * writes the live workspace into the active plan from any surface.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: {
    getState: () => ({ getSelectedProtocol: () => null, selectedDroneId: null, drones: new Map() }),
    setState: vi.fn(),
  },
}));
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

import { useMissionStore } from "@/stores/mission-store";
import { useRallyStore } from "@/stores/rally-store";
import { usePlanLibraryStore } from "@/stores/plan-library-store";
import { applyPlanToWorkspace, saveActivePlanFromWorkspace } from "@/lib/plan-workspace";
import { canUndo, clearHistory, undoHistory } from "@/lib/planner-history";
import type { Waypoint } from "@/lib/types";

const wp = (id: string, lat: number): Waypoint => ({ id, lat, lon: 77.59, alt: 50 });

function planWith(name: string, waypoints: Waypoint[]) {
  const lib = usePlanLibraryStore.getState();
  const id = lib.createPlan(name, waypoints);
  return usePlanLibraryStore.getState().plans.find((p) => p.id === id)!;
}

describe("plan-workspace", () => {
  beforeEach(() => {
    useMissionStore.setState({ waypoints: [] });
    useRallyStore.getState().clearPoints();
    usePlanLibraryStore.setState({ plans: [], folders: [], activePlanId: null, isDirty: false });
    clearHistory();
  });

  it("undo after loading a plan never restores the previous plan's content", () => {
    const a = planWith("A", [wp("a1", 12.9)]);
    const b = planWith("B", [wp("b1", 13.5)]);
    applyPlanToWorkspace(a);
    useMissionStore.getState().updateWaypoint("a1", { lat: 12.95 });
    applyPlanToWorkspace(b);

    expect(canUndo()).toBe(false);
    undoHistory();
    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["b1"]);
  });

  it("saves the live workspace into the active plan", () => {
    const a = planWith("A", [wp("a1", 12.9)]);
    applyPlanToWorkspace(a);
    useMissionStore.getState().addWaypoint(wp("a2", 13.0));
    useRallyStore.getState().addPoint({ id: "r1", lat: 1, lon: 2, alt: 40 });

    saveActivePlanFromWorkspace();

    const saved = usePlanLibraryStore.getState().plans.find((p) => p.id === a.id)!;
    expect(saved.waypoints.map((w) => w.id)).toEqual(["a1", "a2"]);
    expect(saved.rally).toEqual([{ id: "r1", lat: 1, lon: 2, alt: 40 }]);
    expect(usePlanLibraryStore.getState().isDirty).toBe(false);
  });
});
