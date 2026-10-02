/**
 * Terrain samples follow their waypoint's position, and stored plans keep the
 * altitude frame they were made in.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const pending: Array<(v: Array<number | null>) => void> = [];
vi.mock("@/lib/terrain/terrain-provider", () => ({
  getElevations: vi.fn(() => {
    const { promise, resolve } = Promise.withResolvers<Array<number | null>>();
    pending.push(resolve);
    return promise;
  }),
}));
vi.mock("@/stores/drone-selection", () => ({
  droneSelection: () => ({ selectedDroneId: null, drones: new Map() }),
  selectedDroneProtocol: () => null,
}));
vi.mock("@/stores/planner-store", () => ({
  usePlannerStore: { getState: () => ({ defaultFrame: "relative" }), setState: vi.fn() },
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

import { useMissionStore, migrateMissionStore } from "@/stores/mission-store";
import { migratePlanLibrary } from "@/stores/plan-library-store";
import { startGroundElevationSync } from "@/lib/mission/sample-ground-elevations";
import { validateMission } from "@/lib/validation/mission-validator";
import { moveMission } from "@/lib/transforms/mission-transforms";
import { canUndo, clearHistory } from "@/lib/planner-history";
import type { Waypoint } from "@/lib/types";

/** Let the sampler's awaited lookup and its store write settle. */
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

const takeoff: Waypoint = { id: "t", lat: 12.97, lon: 77.59, alt: 0, command: "TAKEOFF", frame: "relative", groundElevation: 100 };
const sampled: Waypoint = { id: "w", lat: 12.98, lon: 77.59, alt: 50, command: "WAYPOINT", frame: "relative", groundElevation: 100 };

describe("terrain samples are derived from position", () => {
  beforeEach(() => {
    pending.length = 0;
    useMissionStore.setState({ waypoints: [takeoff, sampled] });
    clearHistory();
  });

  it("moving a sampled waypoint drops its sample at once and the validator reports terrain unknown", () => {
    useMissionStore.getState().updateWaypoint("w", { lat: 13.1 });
    const moved = useMissionStore.getState().waypoints[1];
    expect(moved.groundElevation).toBeUndefined();

    const result = validateMission(useMissionStore.getState().waypoints);
    const unknown = result.warnings.find((w) => w.code === "TERRAIN_UNCHECKED" && w.waypointId === "w");
    expect(unknown?.message).toMatch(/terrain unknown/);
  });

  it("a drag, a batch edit and a transform all drop the moved sample", () => {
    const store = useMissionStore.getState();
    store.setWaypoints([takeoff, { ...sampled, lat: 13.2 }]);
    expect(useMissionStore.getState().waypoints[1].groundElevation).toBeUndefined();

    useMissionStore.setState({ waypoints: [takeoff, sampled] });
    store.batchUpdateWaypoints(["w"], { lon: 77.7 });
    expect(useMissionStore.getState().waypoints[1].groundElevation).toBeUndefined();

    expect(moveMission([sampled], 0.01, 0)[0].groundElevation).toBeUndefined();
  });

  it("discards a late sample for the old position and writes the new one outside undo", async () => {
    useMissionStore.setState({ waypoints: [{ ...sampled, groundElevation: undefined }] });
    const stop = startGroundElevationSync();
    expect(pending).toHaveLength(1);

    useMissionStore.getState().updateWaypoint("w", { lat: 13.3 });
    expect(pending).toHaveLength(2);
    clearHistory();

    pending[0]([100]); // answer for the position the waypoint has left
    await flush();
    expect(useMissionStore.getState().waypoints[0].groundElevation).toBeUndefined();

    pending[1]([250]);
    await flush();
    expect(useMissionStore.getState().waypoints[0].groundElevation).toBe(250);
    expect(canUndo()).toBe(false);
    stop();
  });
});

describe("stored plans keep their altitude frame", () => {
  it("stamps the then-current default frame on frameless working waypoints", () => {
    const migrated = migrateMissionStore(
      { waypoints: [{ id: "a", lat: 1, lon: 2, alt: 600 }, { id: "b", lat: 1, lon: 2, alt: 30, frame: "terrain" }], activeMission: null },
      5,
      "absolute",
    );
    expect(migrated.waypoints?.map((w) => w.frame)).toEqual(["absolute", "terrain"]);
  });

  it("stamps saved library plans and their frameless waypoints", () => {
    const migrated = migratePlanLibrary(
      { plans: [{ id: "p", name: "P", folderId: null, metadata: {}, createdAt: 0, updatedAt: 0, waypoints: [{ id: "a", lat: 1, lon: 2, alt: 600 }] }] },
      5,
      "absolute",
    );
    expect(migrated.plans[0].frame).toBe("absolute");
    expect(migrated.plans[0].waypoints[0].frame).toBe("absolute");
  });
});
