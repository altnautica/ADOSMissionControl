/**
 * @license GPL-3.0-only
 *
 * "Commit to Flash & Disconnect" may only disconnect once the commit went out.
 * A refused commit keeps the link and the pending writes, so the RAM-only
 * changes are not silently lost.
 */

import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));

import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useParamSafetyStore } from "@/stores/param-safety-store";
import { useDisconnectGuard } from "../use-disconnect-guard";

describe("useDisconnectGuard commit and disconnect", () => {
  it("stays connected with the writes pending when the flash commit fails", async () => {
    const protocol = {
      isConnected: true,
      commitParamsToFlash: async () => ({ success: false, resultCode: 4, message: "denied" }),
    } as Partial<DroneProtocol> as DroneProtocol;
    const drone = { id: "fc:1", name: "D", protocol } as Partial<ManagedDrone> as ManagedDrone;
    const disconnectDrone = vi.fn();
    useDroneManager.setState({ drones: new Map([["fc:1", drone]]), disconnectDrone });
    useParamSafetyStore.getState().clear();
    useParamSafetyStore.getState().trackWrite("ATC_RAT_RLL_P", 0.1, 0.2, "pid");

    const { result } = renderHook(() => useDisconnectGuard());
    act(() => result.current.requestDisconnect("fc:1"));
    await act(async () => {
      await result.current.commitAndDisconnect();
    });

    expect(disconnectDrone).not.toHaveBeenCalled();
    expect(useParamSafetyStore.getState().getPendingCount()).toBe(1);
    expect(toast).toHaveBeenCalledWith(expect.stringContaining("denied"), "error");
  });
});
