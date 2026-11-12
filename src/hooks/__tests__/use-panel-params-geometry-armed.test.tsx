/**
 * @license GPL-3.0-only
 *
 * A frame-geometry edit staged while the vehicle was disarmed is not written
 * once the vehicle may be armed, neither by the panel's Save nor by Ctrl+S.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

vi.mock("@/lib/param-cache-idb", () => ({
  cachePanelToIDB: () => Promise.resolve(),
  getCachedPanelFromIDB: () => Promise.resolve(null),
}));

import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import type { ArmState } from "@/lib/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { useFcPanelActionsStore } from "@/stores/fc-panel-actions-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";
import { usePanelParams } from "../use-panel-params";

const NAMES = ["CA_ROTOR_COUNT", "MPC_XY_VEL_MAX"];

function setup() {
  const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
  const protocol = {
    isConnected: true,
    getParameter: async (name: string) =>
      ({ name, value: 4, type: 9, index: 0, count: 1 }) as ParameterValue,
    setParameter,
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
  useDroneStore.setState({ connectionState: "connected", armState: "disarmed" });
  return setParameter;
}

async function stageThenArm(name: string, armState: ArmState) {
  const hook = renderHook(() =>
    usePanelParams({ paramNames: NAMES, panelId: "geometry-armed", autoLoad: true }),
  );
  await waitFor(() => expect(hook.result.current.hasLoaded).toBe(true));
  act(() => hook.result.current.setLocalValue(name, 6));
  act(() => useDroneStore.setState({ armState }));
  return hook;
}

// The operator answers "Write anyway" to the soft armed-write question, so
// only the geometry hard block stands between the edit and the vehicle.
let unsubscribe = () => {};
beforeEach(() => {
  unsubscribe = useArmedConfirmStore.subscribe((s) => { if (s.open) s.confirm(); });
});

afterEach(() => {
  unsubscribe();
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useDroneStore.setState({ connectionState: "disconnected", armState: "unknown" });
  usePanelCacheStore.getState().clear();
});

describe("staged frame geometry once the vehicle may be armed", () => {
  it.each<ArmState>(["armed", "unknown"])("Save refuses the write (%s)", async (armState) => {
    const setParameter = setup();
    const { result } = await stageThenArm("CA_ROTOR_COUNT", armState);
    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.saveAllToRam(); });
    expect(ok).toBe(false);
    expect(setParameter).not.toHaveBeenCalled();
    expect(result.current.dirtyParams.has("CA_ROTOR_COUNT")).toBe(true);
  });

  it("Ctrl+S refuses the write", async () => {
    const setParameter = setup();
    await stageThenArm("CA_ROTOR_COUNT", "armed");
    const save = useFcPanelActionsStore.getState().saveToRam;
    let outcome: { attempted: number; ok: boolean } | undefined;
    await act(async () => { outcome = await save?.(); });
    expect(outcome).toEqual({ attempted: 1, ok: false });
    expect(setParameter).not.toHaveBeenCalled();
  });

  it("writes the same edit once the vehicle is known disarmed", async () => {
    const setParameter = setup();
    const { result } = await stageThenArm("CA_ROTOR_COUNT", "disarmed");
    await act(async () => { await result.current.saveAllToRam(); });
    expect(setParameter).toHaveBeenCalledWith("CA_ROTOR_COUNT", 6);
  });
});
