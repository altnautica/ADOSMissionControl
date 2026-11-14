/**
 * @license GPL-3.0-only
 *
 * A FLOW_ORIENT_YAW value outside -17999..18000 or off the 10 cdeg step is
 * never written by an FC panel, neither by Save nor by Ctrl+S, and nothing
 * else staged in the same save is written either.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/param-cache-idb", () => ({
  cachePanelToIDB: () => Promise.resolve(),
  getCachedPanelFromIDB: () => Promise.resolve(null),
}));

import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";
import { usePanelParams } from "../use-panel-params";

const NAMES = ["FLOW_ORIENT_YAW", "FLOW_FXSCALER"];

function setup() {
  const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
  const protocol = {
    isConnected: true,
    getParameter: async (name: string) =>
      ({ name, value: 0, type: 9, index: 0, count: 1 }) as ParameterValue,
    setParameter,
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
  useDroneStore.setState({ connectionState: "connected", armState: "disarmed" });
  return setParameter;
}

async function stage(yaw: number) {
  const hook = renderHook(() =>
    usePanelParams({ paramNames: NAMES, panelId: "fixed-limits", autoLoad: true }),
  );
  await waitFor(() => expect(hook.result.current.hasLoaded).toBe(true));
  act(() => {
    hook.result.current.setLocalValue("FLOW_FXSCALER", 20);
    hook.result.current.setLocalValue("FLOW_ORIENT_YAW", yaw);
  });
  return hook;
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useDroneStore.setState({ connectionState: "disconnected", armState: "unknown" });
  usePanelCacheStore.getState().clear();
});

describe("an invalid FLOW_ORIENT_YAW in an FC panel save", () => {
  it.each([4, 4505, 36000])("Ctrl+S writes nothing (%i)", async (yaw) => {
    const setParameter = setup();
    const { result } = await stage(yaw);
    const save = useFcPanelActionsStore.getState().saveToRam;
    let outcome: { attempted: number; ok: boolean } | undefined;
    await act(async () => { outcome = await save?.(); });
    expect(outcome).toEqual({ attempted: 2, ok: false });
    expect(setParameter).not.toHaveBeenCalled();
    expect(result.current.dirtyParams.has("FLOW_ORIENT_YAW")).toBe(true);
  });

  it("Save writes nothing", async () => {
    const setParameter = setup();
    const { result } = await stage(4);
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.saveAllToRam(); });
    expect(ok).toBe(false);
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("writes a valid yaw", async () => {
    const setParameter = setup();
    await stage(18000);
    const save = useFcPanelActionsStore.getState().saveToRam;
    await act(async () => { await save?.(); });
    expect(setParameter).toHaveBeenCalledWith("FLOW_ORIENT_YAW", 18000);
  });
});
