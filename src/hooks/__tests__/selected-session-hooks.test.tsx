/**
 * @license GPL-3.0-only
 *
 * Hooks that describe "the selected drone's FC" must follow the selection and
 * the session behind it: a connect has to reach them without anything else
 * happening to re-render the caller.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type {
  DroneProtocol,
  FirmwareHandler,
  ProtocolCapabilities,
  VehicleInfo,
} from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useFirmwareCapabilities } from "../use-firmware-capabilities";

const NODE = "node:d1";

function fakeProtocol(): DroneProtocol {
  return {
    isConnected: true,
    getCapabilities: () => ({ supportsGeofence: true }) as Partial<ProtocolCapabilities> as ProtocolCapabilities,
    getFirmwareHandler: () =>
      ({ firmwareType: "ardupilot-copter", vehicleClass: "copter" }) as Partial<FirmwareHandler> as FirmwareHandler,
    getVehicleInfo: () =>
      ({ firmwareType: "ardupilot-copter", vehicleClass: "copter" }) as Partial<VehicleInfo> as VehicleInfo,
  } as Partial<DroneProtocol> as DroneProtocol;
}

function attach(protocol: DroneProtocol): void {
  const drone = { id: NODE, name: "Drone 1", protocol } as Partial<ManagedDrone> as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[NODE, drone]]), selectedDroneId: NODE });
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("useFirmwareCapabilities", () => {
  it("reports the FC once it connects, with no other render trigger", () => {
    const { result } = renderHook(() => useFirmwareCapabilities());
    expect(result.current.isConnected).toBe(false);

    act(() => attach(fakeProtocol()));

    expect(result.current.isConnected).toBe(true);
    expect(result.current.firmwareType).toBe("ardupilot-copter");
  });
});
