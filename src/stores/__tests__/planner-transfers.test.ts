/**
 * @license GPL-3.0-only
 *
 * What the planner says the flight controller holds after a fence or mission
 * transfer. A fence upload may only vouch for what the transfer carried, a
 * download replaces the planner with exactly what the FC returned, and the
 * replacement is one undo step like any other planner edit.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

import type { DroneProtocol, FenceElement, MissionItem } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "../drone-manager";
import { useGeofenceStore } from "../geofence-store";
import { useMissionStore } from "../mission-store";
import { useNodeRegistryStore } from "../node-registry";
import { useRallyStore, type RallyPoint } from "../rally-store";
import { useUploadReceiptsStore } from "../upload-receipts-store";
import type { Waypoint } from "@/lib/types";
import { useMissionStateStore, type MissionStateKind } from "@/lib/mission/mission-state";

const DRONE = "node:d1";

function selectProtocol(protocol: DroneProtocol): void {
  const drone = { id: DRONE, name: "Drone 1", protocol } as Partial<ManagedDrone> as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[DRONE, drone]]), selectedDroneId: DRONE });
}

function baseProtocol(extra: Partial<DroneProtocol>): DroneProtocol {
  return {
    getVehicleInfo: () => ({ firmwareType: "ardupilot-copter" }),
    setParameter: vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" })),
    getParameter: vi.fn(async (name: string) => ({
      name,
      value: name === "FENCE_ENABLE" ? 1 : name === "FENCE_ACTION" ? 1 : 100,
      type: 9,
      index: 0,
      count: 0,
    })),
    ...extra,
  } as Partial<DroneProtocol> as DroneProtocol;
}

const square: [number, number][] = [
  [47.0, 8.0],
  [47.0, 8.001],
  [47.001, 8.001],
  [47.001, 8.0],
];

const zone = {
  role: "exclusion" as const,
  type: "circle" as const,
  polygonPoints: [],
  circleCenter: [47.0005, 8.0005] as [number, number],
  circleRadius: 20,
};

beforeEach(() => {
  useGeofenceStore.getState().clearFence();
  useUploadReceiptsStore.getState().clearForDrone(DRONE);
  useMissionStore.setState({ waypoints: [], downloadState: "idle", downloadWarnings: [] });
});

describe("fence upload", () => {
  it("sends every zone through the mission-type fence protocol", async () => {
    const uploadFenceMission = vi.fn(async (_elements: FenceElement[]) => ({
      success: true,
      resultCode: 0,
      message: "Uploaded",
    }));
    selectProtocol(baseProtocol({ uploadFenceMission }));
    const fence = useGeofenceStore.getState();
    fence.setFenceType("polygon");
    fence.setPolygonPoints(square);
    fence.addZone(zone);

    const result = await useGeofenceStore.getState().uploadFence();

    expect(result.success).toBe(true);
    expect(uploadFenceMission).toHaveBeenCalledTimes(1);
    expect(uploadFenceMission.mock.calls[0][0]).toHaveLength(2);
  });

  it("never clears the vehicle's fence from an empty upload", async () => {
    const uploadFenceMission = vi.fn(async (_elements: FenceElement[]) => ({ success: true, resultCode: 0, message: "ok" }));
    selectProtocol(baseProtocol({ uploadFenceMission }));

    const result = await useGeofenceStore.getState().uploadFence();

    expect(result.success).toBe(false);
    expect(uploadFenceMission).not.toHaveBeenCalled();
  });
});

describe("vehicle fence clear", () => {
  it("uploads an empty fence mission and drops the fence receipt", async () => {
    const uploadFenceMission = vi.fn(async (_elements: FenceElement[]) => ({ success: true, resultCode: 0, message: "ok" }));
    selectProtocol(baseProtocol({ uploadFenceMission }));
    useUploadReceiptsStore.getState().record("fence", { droneId: DRONE, contentHash: "abc", at: 1 });

    const result = await useGeofenceStore.getState().clearVehicleFence();

    expect(result.success).toBe(true);
    expect(uploadFenceMission).toHaveBeenCalledWith([]);
    expect(useUploadReceiptsStore.getState().receipts[DRONE]?.fence).toBeUndefined();
  });
});

describe("mission download", () => {
  it("is one undo step back to the operator's plan", async () => {
    const mine: Waypoint = { id: "wp-local", lat: 1, lon: 2, alt: 30 } as Waypoint;
    useMissionStore.getState().setWaypoints([mine]);
    const item: MissionItem = {
      seq: 1,
      frame: 3,
      command: 16,
      current: 0,
      autocontinue: 1,
      param1: 0,
      param2: 0,
      param3: 0,
      param4: 0,
      x: 470000000,
      y: 80000000,
      z: 50,
    };
    selectProtocol(
      baseProtocol({ downloadMission: vi.fn(async () => [{ ...item, seq: 0 }, item]) }),
    );

    const downloaded = await useMissionStore.getState().downloadMission();
    expect(downloaded).toHaveLength(1);
    expect(useMissionStore.getState().waypoints[0].id).not.toBe("wp-local");

    useMissionStore.getState().undo();

    expect(useMissionStore.getState().waypoints.map((w) => w.id)).toEqual(["wp-local"]);
  });
});

describe("uploads while the vehicle flies its mission", () => {
  const REFUSAL = "Pause the mission before uploading";
  const OTHER = "node:d2";
  const plan: Waypoint[] = [
    { id: "a", lat: 47, lon: 8, alt: 30, command: "TAKEOFF" } as Waypoint,
    { id: "b", lat: 47.001, lon: 8, alt: 30, command: "WAYPOINT" } as Waypoint,
  ];

  /** The mission state the link computes for `id`. */
  function report(id: string, state: MissionStateKind | null): void {
    const status = useMissionStateStore.getState().status;
    const next = { ...status };
    if (state === null) delete next[id];
    else
      next[id] = {
        state,
        seq: 1,
        total: 2,
        itemReached: null,
        id: null,
        source: "mission_state",
        ageMs: 0,
        landingSeq: false,
      };
    useMissionStateStore.setState({ status: next });
  }

  function missionProtocol() {
    const uploadMission = vi.fn(async (_items: MissionItem[]) => ({ success: true, resultCode: 0, message: "ok" }));
    return { protocol: baseProtocol({ uploadMission }), uploadMission };
  }

  beforeEach(() => {
    useNodeRegistryStore.getState().clear();
    useMissionStateStore.setState({ inputs: {}, status: {} });
    useUploadReceiptsStore.getState().clearForDrone(OTHER);
    useMissionStore.setState({ waypoints: plan, uploadState: "idle", uploadError: null });
  });

  it("refuses a mission upload while the mission is active and sends nothing", async () => {
    const { protocol, uploadMission } = missionProtocol();
    selectProtocol(protocol);
    report(DRONE, "active");

    await expect(useMissionStore.getState().uploadMission(protocol)).resolves.toBe(false);
    expect(useMissionStore.getState()).toMatchObject({ uploadState: "error", uploadError: REFUSAL });
    expect(uploadMission).not.toHaveBeenCalled();
  });

  it.each([
    ["with its mission paused", "paused"],
    ["with a mission loaded", "loaded"],
    ["with no mission", "none"],
    ["of unknown mission state", null],
  ] as const)("uploads a mission to a vehicle %s", async (_label, state) => {
    const { protocol, uploadMission } = missionProtocol();
    selectProtocol(protocol);
    report(DRONE, state);

    await expect(useMissionStore.getState().uploadMission(protocol)).resolves.toBe(true);
    expect(uploadMission).toHaveBeenCalledTimes(1);
  });

  function selectTwo(selected: DroneProtocol, target: DroneProtocol): void {
    const d1 = { id: DRONE, name: "Drone 1", protocol: selected } as Partial<ManagedDrone> as ManagedDrone;
    const d2 = { id: OTHER, name: "Drone 2", protocol: target } as Partial<ManagedDrone> as ManagedDrone;
    useDroneManager.setState({ drones: new Map([[DRONE, d1], [OTHER, d2]]), selectedDroneId: DRONE });
  }

  it("reads the target's state, not the selected drone's", async () => {
    const selected = missionProtocol();
    const target = missionProtocol();
    selectTwo(selected.protocol, target.protocol);
    report(DRONE, "none");
    report(OTHER, "active");

    await expect(useMissionStore.getState().uploadMission(target.protocol)).resolves.toBe(false);
    expect(target.uploadMission).not.toHaveBeenCalled();
  });

  it("uploads to a grounded target while the selected drone flies its mission", async () => {
    const selected = missionProtocol();
    const target = missionProtocol();
    selectTwo(selected.protocol, target.protocol);
    report(DRONE, "active");
    report(OTHER, "loaded");

    await expect(useMissionStore.getState().uploadMission(target.protocol)).resolves.toBe(true);
    expect(target.uploadMission).toHaveBeenCalledTimes(1);
  });

  it("refuses a fence upload", async () => {
    const uploadFenceMission = vi.fn(async (_elements: FenceElement[]) => ({ success: true, resultCode: 0, message: "ok" }));
    selectProtocol(baseProtocol({ uploadFenceMission }));
    report(DRONE, "active");
    const fence = useGeofenceStore.getState();
    fence.setFenceType("polygon");
    fence.setPolygonPoints(square);

    await expect(useGeofenceStore.getState().uploadFence()).resolves.toEqual({ success: false, message: REFUSAL });
    expect(uploadFenceMission).not.toHaveBeenCalled();
  });

  it("refuses a rally upload", async () => {
    const uploadRallyPoints = vi.fn(async () => ({ success: true, resultCode: 0, message: "ok" }));
    selectProtocol(baseProtocol({ uploadRallyPoints }));
    report(DRONE, "active");
    useRallyStore.setState({ points: [{ id: "r1", lat: 47, lon: 8, alt: 30 } as RallyPoint] });

    await expect(useRallyStore.getState().uploadRallyPoints()).resolves.toEqual({ success: false, message: REFUSAL });
    expect(uploadRallyPoints).not.toHaveBeenCalled();
  });
});
