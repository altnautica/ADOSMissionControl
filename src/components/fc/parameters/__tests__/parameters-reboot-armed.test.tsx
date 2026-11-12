/**
 * @license GPL-3.0-only
 *
 * The Parameters "restart required" prompt never reboots a vehicle that may
 * be armed, even if the prompt was opened while it was disarmed.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { ArmState } from "@/lib/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/lib/protocol/param-metadata", () => ({ loadParamMetadata: async () => new Map() }));

import { useParameterEdits } from "../use-parameter-edits";

function setup(armState: ArmState) {
  const reboot = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
  const protocol = {
    isConnected: true,
    reboot,
    onParameter: () => () => {},
    getAllParameters: async () => [],
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
  useDroneStore.setState({ armState, connectionState: "connected" });
  return reboot;
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
});

describe("Parameters reboot prompt", () => {
  it.each<ArmState>(["armed", "unknown"])("sends nothing while the arm state is %s", async (armState) => {
    const reboot = setup(armState);
    const { result } = renderHook(() => useParameterEdits(), { wrapper: IntlWrapper });
    await act(async () => { await result.current.reboot(); });
    expect(reboot).not.toHaveBeenCalled();
  });

  it("reboots a disarmed vehicle", async () => {
    const reboot = setup("disarmed");
    const { result } = renderHook(() => useParameterEdits(), { wrapper: IntlWrapper });
    await act(async () => { await result.current.reboot(); });
    expect(reboot).toHaveBeenCalledTimes(1);
  });
});
