/**
 * @license GPL-3.0-only
 *
 * Flashing an FC reboots it into its bootloader, so the flash path refuses to
 * start on an armed vehicle regardless of the self-attested checklist.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useFirmwareState } from "../useFirmwareState";

const lock = { isHardBlocked: true };
const toast = vi.fn();
const getFirmwareUrl = vi.fn(async () => null);

vi.mock("@/hooks/use-armed-lock", () => ({
  useArmedLock: () => ({
    isArmed: lock.isHardBlocked,
    isHardBlocked: lock.isHardBlocked,
    lockMessage: "",
    hardBlockMessage: lock.isHardBlocked ? "armed" : "",
  }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/stores/drone-manager", () => ({
  useDroneManager: (sel: (s: unknown) => unknown) => sel({ selectedDroneId: null, drones: new Map() }),
  selectSelectedDrone: () => null,
}));
vi.mock("../firmware-state/manifests", () => ({
  apManifest: { getFirmwareUrl: () => getFirmwareUrl() },
  bfManifest: {},
  px4Manifest: {},
  adosManifest: {},
}));
vi.mock("../firmware-state/use-ardupilot-firmware", () => ({
  useArduPilotFirmware: () => ({
    apBoards: [{ name: "MatekH743", vehicleTypes: ["Copter"] }],
    loadApManifest: vi.fn(),
    selectedApBoard: "MatekH743",
    selectedVehicleType: "Copter",
    selectedApVersion: "stable-4.5.0",
  }),
}));
vi.mock("../firmware-state/use-betaflight-firmware", () => ({
  useBetaflightFirmware: () => ({ bfTargets: [], loadBfTargets: vi.fn() }),
}));
vi.mock("../firmware-state/use-px4-firmware", () => ({
  usePx4Firmware: () => ({ px4Releases: [], loadPx4Releases: vi.fn() }),
}));
vi.mock("../firmware-state/use-ados-agent-firmware", () => ({
  useAdosAgentFirmware: () => ({ adosBoards: [], loadAdosManifest: vi.fn() }),
}));

describe("useFirmwareState · armed vehicle", () => {
  beforeEach(() => {
    toast.mockReset();
    getFirmwareUrl.mockClear();
  });

  it("refuses to start a flash while the vehicle is armed", async () => {
    lock.isHardBlocked = true;
    const { result } = renderHook(() => useFirmwareState());
    expect(result.current.flashBlockedReason).toBe("armed");
    await act(async () => {
      await result.current.handleFlash();
    });
    expect(getFirmwareUrl).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("armed", "error");
  });

  it("starts the flash path when disarmed", async () => {
    lock.isHardBlocked = false;
    const { result } = renderHook(() => useFirmwareState());
    expect(result.current.flashBlockedReason).toBeNull();
    await act(async () => {
      await result.current.handleFlash();
    });
    expect(getFirmwareUrl).toHaveBeenCalledTimes(1);
  });
});
