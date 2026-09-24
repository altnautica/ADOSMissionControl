/**
 * @license GPL-3.0-only
 *
 * A parameter panel that outlives a drone switch reloads for the new drone.
 * The previous drone's load, still waiting on its flight controller, must not
 * land afterwards: its values would show (and save) as the new drone's.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("@/lib/param-cache-idb", () => ({
  cachePanelToIDB: () => Promise.resolve(),
  getCachedPanelFromIDB: () => Promise.resolve(null),
}));

import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { usePanelParams } from "../use-panel-params";

const NAMES = ["ATC_RAT_RLL_P"];

function protocolAnswering(read: () => Promise<number>): DroneProtocol {
  return {
    isConnected: true,
    getParameter: async (name: string) =>
      ({ name, value: await read(), type: 9, index: 0, count: 1 }) as ParameterValue,
  } as Partial<DroneProtocol> as DroneProtocol;
}

function drone(id: string, protocol: DroneProtocol): [string, ManagedDrone] {
  return [id, { id, name: id, protocol } as Partial<ManagedDrone> as ManagedDrone];
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  usePanelCacheStore.getState().clear();
});

describe("usePanelParams across a drone switch", () => {
  it("keeps the new drone's values when the previous drone's load lands late", async () => {
    const slowA = Promise.withResolvers<number>();
    useDroneManager.setState({
      drones: new Map([
        drone("A", protocolAnswering(() => slowA.promise)),
        drone("B", protocolAnswering(async () => 0.2)),
      ]),
      selectedDroneId: "A",
    });

    const { result } = renderHook(() =>
      usePanelParams({ paramNames: NAMES, panelId: "pid-switch", autoLoad: true }),
    );

    await act(async () => {
      useDroneManager.setState({ selectedDroneId: "B" });
    });
    expect(result.current.params.get("ATC_RAT_RLL_P")).toBe(0.2);

    await act(async () => {
      slowA.resolve(0.9);
    });

    expect(result.current.params.get("ATC_RAT_RLL_P")).toBe(0.2);
    expect(usePanelCacheStore.getState().getCachedPanel("pid-switch")?.params.get("ATC_RAT_RLL_P")).toBe(0.2);
  });
});
