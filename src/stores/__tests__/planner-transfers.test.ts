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
import { useUploadReceiptsStore } from "../upload-receipts-store";
import type { Waypoint } from "@/lib/types";

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
  it("sends every zone through the mission-type fence protocol when the adapter has it", async () => {
    const uploadFenceMission = vi.fn(async (_elements: FenceElement[]) => ({
      success: true,
      resultCode: 0,
      message: "Uploaded",
    }));
    const uploadFence = vi.fn(async () => ({ success: true, resultCode: 0, message: "Uploaded" }));
    selectProtocol(baseProtocol({ uploadFenceMission, uploadFence }));
    const fence = useGeofenceStore.getState();
    fence.setFenceType("polygon");
    fence.setPolygonPoints(square);
    fence.addZone(zone);

    const result = await useGeofenceStore.getState().uploadFence();

    expect(result.success).toBe(true);
    expect(uploadFence).not.toHaveBeenCalled();
    expect(uploadFenceMission).toHaveBeenCalledTimes(1);
    expect(uploadFenceMission.mock.calls[0][0]).toHaveLength(2);
  });

  it("refuses zones on a boundary-only protocol instead of vouching for them", async () => {
    const uploadFence = vi.fn(async () => ({ success: true, resultCode: 0, message: "Uploaded" }));
    selectProtocol(baseProtocol({ uploadFence }));
    const fence = useGeofenceStore.getState();
    fence.setFenceType("polygon");
    fence.setPolygonPoints(square);
    fence.addZone(zone);

    const result = await useGeofenceStore.getState().uploadFence();

    expect(result.success).toBe(false);
    expect(uploadFence).not.toHaveBeenCalled();
    expect(useUploadReceiptsStore.getState().receipts[DRONE]?.fence).toBeUndefined();
  });
});

describe("fence download", () => {
  it("drops local zones when the FC's boundary-only fence replaces the planner's", async () => {
    const downloadFence = vi.fn(async () => square.map(([lat, lon], idx) => ({ idx, lat, lon })));
    selectProtocol(baseProtocol({ downloadFence }));
    useGeofenceStore.getState().addZone(zone);

    const result = await useGeofenceStore.getState().downloadFence();

    expect(result.success).toBe(true);
    expect(useGeofenceStore.getState().zones).toEqual([]);
    expect(useGeofenceStore.getState().polygonPoints).toHaveLength(4);
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
