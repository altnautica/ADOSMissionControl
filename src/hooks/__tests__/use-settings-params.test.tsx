/**
 * @license GPL-3.0-only
 *
 * A settings panel shows one drone's values. After a drone switch it must not
 * keep, or late-apply, values read from the previous drone: a Write would send
 * them to the new one.
 */

import { describe, it, expect, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useSettingsParams } from "../use-settings-params";

interface Values {
  rate: number;
}

const INITIAL: Values = { rate: 0 };
const supported = () => true;
const write = async () => {};

function droneWith(id: string, protocol: DroneProtocol): [string, ManagedDrone] {
  return [id, { id, name: id, protocol } as Partial<ManagedDrone> as ManagedDrone];
}

function protocolFor(): DroneProtocol {
  return { isConnected: true } as Partial<DroneProtocol> as DroneProtocol;
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("useSettingsParams across a drone switch", () => {
  it("drops a read that settles after the switch and returns to the unread state", async () => {
    const a = protocolFor();
    const b = protocolFor();
    useDroneManager.setState({
      drones: new Map([droneWith("A", a), droneWith("B", b)]),
      selectedDroneId: "A",
    });
    const { promise, resolve } = Promise.withResolvers<Values>();
    const read = (p: DroneProtocol) => (p === a ? promise : Promise.resolve({ rate: 2 }));

    const { result } = renderHook(() =>
      useSettingsParams<Values>({
        panelId: "rates",
        initial: INITIAL,
        read,
        write,
        supported,
        unsupportedMessage: "unsupported",
      }),
    );

    let pending!: Promise<void>;
    act(() => {
      pending = result.current.read();
    });
    act(() => useDroneManager.setState({ selectedDroneId: "B" }));
    await act(async () => {
      resolve({ rate: 7 });
      await pending;
    });

    expect(result.current.values).toEqual(INITIAL);
    expect(result.current.hasLoaded).toBe(false);
    expect(result.current.dirty).toBe(false);
  });

  it("forgets unsaved edits made for the previous drone", () => {
    useDroneManager.setState({
      drones: new Map([droneWith("A", protocolFor()), droneWith("B", protocolFor())]),
      selectedDroneId: "A",
    });
    const { result } = renderHook(() =>
      useSettingsParams<Values>({
        panelId: "rates",
        initial: INITIAL,
        read: async () => ({ rate: 1 }),
        write,
        supported,
        unsupportedMessage: "unsupported",
      }),
    );

    act(() => result.current.setValues({ rate: 9 }));
    expect(result.current.dirty).toBe(true);
    act(() => useDroneManager.setState({ selectedDroneId: "B" }));

    expect(result.current.values).toEqual(INITIAL);
    expect(result.current.dirty).toBe(false);
  });
});
