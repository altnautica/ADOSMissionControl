/**
 * Verifies the stack-aware checklist logic in useFirmwareState. Switching
 * the firmware stack between flight-controller stacks (ArduPilot, etc.)
 * and the ADOS agent stacks must surface the correct safety items, and
 * `allChecked` must reset across the boundary because the item keys
 * diverge between the two checklists.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/protocol/firmware/manifest", () => ({
  ArduPilotManifest: class {
    async getManifest() { return {}; }
    async getBoards() { return []; }
    async getVersions() { return []; }
    clearCache() {}
  },
}));

vi.mock("@/lib/protocol/firmware/betaflight-manifest", () => ({
  BetaflightManifest: class {
    async getTargets() { return []; }
    async getReleasesForTarget() { return []; }
    async getBuildOptions() { return null; }
    clearCache() {}
  },
}));

vi.mock("@/lib/protocol/firmware/px4-manifest", () => ({
  PX4Manifest: class {
    async getReleases() { return []; }
    clearCache() {}
  },
}));

vi.mock("@/lib/protocol/firmware/ados-agent-manifest", () => ({
  AdosAgentManifest: class {
    async getManifest() {
      return {
        schemaVersion: 1,
        agentVersion: "lite-v0.1.3",
        generatedAt: "2026-05-06T00:00:00Z",
        boards: [],
      };
    }
    async getBoardsForStack() { return []; }
    async getBoardById() { return null; }
    async getInstall() { return null; }
    async getAgentVersion() { return "lite-v0.1.3"; }
    clearCache() {}
  },
}));

vi.mock("@/lib/protocol/firmware/stm32-dfu", () => ({
  STM32DfuFlasher: {
    isSupported: () => false,
    getKnownDevices: async () => [],
    requestDevice: async () => { throw new Error("not in test"); },
  },
}));

vi.mock("@/lib/usb-device-manager", () => ({
  usbDeviceManager: {
    init: () => {},
    isSupported: () => false,
    getKnownDevices: async () => [],
    onConnect: () => () => {},
    onDisconnect: () => () => {},
  },
}));

vi.mock("@/lib/protocol/firmware/flash-manager", () => ({
  FlashManager: class {
    async flash() {}
    abort() {}
  },
}));

vi.mock("@/stores/drone-manager", () => {
  return {
    useDroneManager: vi.fn((selector?: (s: unknown) => unknown) => {
      const state = { selectedDroneId: null, drones: new Map() };
      return selector ? selector(state) : state;
    }),
    selectSelectedDrone: () => null,
  };
});

// ── Tests ────────────────────────────────────────────────────────────────

import { useFirmwareState } from "@/components/fc/firmware/useFirmwareState";

describe("useFirmwareState — stack-aware checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts on the ardupilot stack with the FC checklist items", () => {
    const { result } = renderHook(() => useFirmwareState());

    expect(result.current.firmwareStack).toBe("ardupilot");
    const keys = result.current.checklistItems.map((c) => c.key).sort();
    expect(keys).toEqual(["batteryOff", "paramBackup", "propsRemoved"]);
  });

  it("swaps to ADOS items when the stack switches to ados-drone-agent", () => {
    const { result } = renderHook(() => useFirmwareState());

    act(() => {
      result.current.setFirmwareStack("ados-drone-agent");
    });

    const keys = result.current.checklistItems.map((c) => c.key).sort();
    expect(keys).toEqual(["adosBackup", "adosDataLoss", "adosUsbPower"]);
  });

  it("uses the ADOS items for the ground-agent stack as well", () => {
    const { result } = renderHook(() => useFirmwareState());

    act(() => {
      result.current.setFirmwareStack("ados-ground-agent");
    });

    const keys = result.current.checklistItems.map((c) => c.key).sort();
    expect(keys).toEqual(["adosBackup", "adosDataLoss", "adosUsbPower"]);
  });

  it("reports allChecked=false when no items are checked", () => {
    const { result } = renderHook(() => useFirmwareState());
    expect(result.current.allChecked).toBe(false);
  });

  it("reports allChecked=true when every FC item key has been checked", () => {
    const { result } = renderHook(() => useFirmwareState());

    act(() => {
      result.current.setChecked("paramBackup", true);
    });
    act(() => {
      result.current.setChecked("propsRemoved", true);
    });
    act(() => {
      result.current.setChecked("batteryOff", true);
    });

    expect(result.current.allChecked).toBe(true);
  });

  it("resets allChecked to false when the stack moves from FC to ADOS", () => {
    const { result } = renderHook(() => useFirmwareState());

    act(() => {
      result.current.setChecked("paramBackup", true);
    });
    act(() => {
      result.current.setChecked("propsRemoved", true);
    });
    act(() => {
      result.current.setChecked("batteryOff", true);
    });
    expect(result.current.allChecked).toBe(true);

    act(() => {
      result.current.setFirmwareStack("ados-drone-agent");
    });

    // ADOS items aren't checked; allChecked must drop back to false even
    // though every FC item is still flagged in the checked map.
    expect(result.current.allChecked).toBe(false);
  });

  it("reaches allChecked=true on the ADOS stack after flagging the ADOS items", () => {
    const { result } = renderHook(() => useFirmwareState());

    act(() => {
      result.current.setFirmwareStack("ados-drone-agent");
    });
    act(() => {
      result.current.setChecked("adosDataLoss", true);
    });
    act(() => {
      result.current.setChecked("adosUsbPower", true);
    });
    act(() => {
      result.current.setChecked("adosBackup", true);
    });

    expect(result.current.allChecked).toBe(true);
  });
});
