/**
 * @license GPL-3.0-only
 *
 * The ArduPilot flash picker preselects the firmware the connected vehicle
 * runs, so a plane is not offered Copter firmware by default.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useArduPilotFirmware } from "../firmware-state/use-ardupilot-firmware";
import type { ManagedDrone } from "@/stores/drone-manager";

vi.mock("../firmware-state/manifests", () => ({
  apManifest: {
    getManifest: vi.fn(async () => undefined),
    getBoards: vi.fn(async () => [{ name: "CubeOrange", vehicleTypes: ["Copter", "Plane"] }]),
    getVersions: vi.fn(async () => ["stable-4.5.0"]),
    clearCache: vi.fn(),
  },
}));

function plane(): ManagedDrone {
  const partial: Pick<ManagedDrone, "vehicleInfo"> = {
    vehicleInfo: {
      firmwareType: "ardupilot-plane",
      vehicleClass: "plane",
      firmwareVersionString: "ArduPlane V4.5.0",
    } as ManagedDrone["vehicleInfo"],
  };
  return partial as ManagedDrone;
}

describe("useArduPilotFirmware", () => {
  it("preselects Plane firmware for a connected plane after the catalog loads", async () => {
    const { result } = renderHook(() => useArduPilotFirmware("ardupilot", plane()));
    await act(async () => {
      await result.current.loadApManifest();
    });
    expect(result.current.selectedApBoard).toBe("CubeOrange");
    expect(result.current.selectedVehicleType).toBe("Plane");
  });
});
