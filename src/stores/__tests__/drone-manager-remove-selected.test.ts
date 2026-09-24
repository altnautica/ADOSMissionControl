/**
 * @license GPL-3.0-only
 *
 * When the selected drone's FC session ends, the single-slot state that only
 * ever describes the selected drone goes with it: its track on the map and its
 * latched fence-breach alarm must not outlive the vehicle they describe.
 */

import { describe, it, expect } from "vitest";

import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "../drone-manager";
import { useTrailStore } from "../trail-store";
import { useGeofenceStore } from "../geofence-store";

describe("removing the selected drone", () => {
  it("clears its trail and its latched fence breach", () => {
    const protocol = { isConnected: false } as Partial<DroneProtocol> as DroneProtocol;
    const drone = {
      id: "fc:1",
      name: "Drone 1",
      protocol,
      unsubscribers: [],
      _disconnectReason: null,
    } as Partial<ManagedDrone> as ManagedDrone;
    useDroneManager.setState({ drones: new Map([["fc:1", drone]]), selectedDroneId: "fc:1" });
    useTrailStore.getState().pushPoint(47.0, 8.0, 10);
    useGeofenceStore.getState().updateBreachState(1, 3, 3);

    useDroneManager.getState().removeDrone("fc:1");

    expect(useTrailStore.getState()._ring.length).toBe(0);
    expect(useGeofenceStore.getState().breachStatus).toBe(0);
  });
});
