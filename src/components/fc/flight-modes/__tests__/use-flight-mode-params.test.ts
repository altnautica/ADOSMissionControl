/**
 * @license GPL-3.0-only
 *
 * The Flight Modes panel reads and writes the vehicle's own mode-switch
 * parameters: ArduRover names them MODE_CH / MODE1..6, every other ArduPilot
 * vehicle FLTMODE_CH / FLTMODE1..6.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useFlightModeParams } from "../use-flight-mode-params";
import { ArduCopterHandler, ArduRoverHandler } from "@/lib/protocol/firmware/ardupilot";
import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import type { DroneProtocol } from "@/lib/protocol/types";
import type { FirmwareHandler } from "@/lib/protocol/types/firmware";
import { useDroneStore } from "@/stores/drone-store";
import { useArmedConfirmStore } from "@/stores/armed-confirm-store";

function fakeProtocol() {
  const getParameter = vi.fn(async (name: string) => ({
    name,
    value: 0,
    type: 9,
    index: 0,
    count: 1,
  }));
  const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
  const fake: Pick<DroneProtocol, "getParameter" | "setParameter"> = {
    getParameter,
    setParameter,
  };
  return { protocol: fake as DroneProtocol, getParameter, setParameter };
}

async function load(handler: FirmwareHandler, isCopter: boolean) {
  const { protocol, getParameter, setParameter } = fakeProtocol();
  const { result } = renderHook(() =>
    useFlightModeParams({ protocol, firmwareHandler: handler, isCopter, toast: vi.fn() }),
    { wrapper: IntlWrapper },
  );
  await act(async () => {
    await result.current.fetchParams();
  });
  const read = getParameter.mock.calls.map(([name]) => name);
  return { result, read, setParameter };
}

describe("useFlightModeParams · mode-switch parameter names", () => {
  it("reads MODE_CH and MODE1..6 on ArduRover", async () => {
    const { read } = await load(new ArduRoverHandler(), false);
    expect(read).toContain("MODE_CH");
    expect(read).toContain("MODE1");
    expect(read).toContain("MODE6");
    expect(read.some((n) => n.startsWith("FLTMODE"))).toBe(false);
  });

  it("writes the rover channel under MODE_CH", async () => {
    const { result, setParameter } = await load(new ArduRoverHandler(), false);
    act(() => result.current.updateGlobal({ modeChannel: "7" }));
    await act(async () => {
      await result.current.saveParams();
    });
    expect(setParameter).toHaveBeenCalledWith("MODE_CH", 7);
  });

  it("keeps FLTMODE_CH and FLTMODE1..6 on ArduCopter", async () => {
    const { read } = await load(new ArduCopterHandler(), true);
    expect(read).toContain("FLTMODE_CH");
    expect(read).toContain("FLTMODE1");
    expect(read).not.toContain("MODE_CH");
  });
});

describe("useFlightModeParams · armed guard", () => {
  it("asks before writing to an armed vehicle and writes nothing on cancel", async () => {
    const { result, setParameter } = await load(new ArduCopterHandler(), true);
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    act(() => result.current.updateGlobal({ modeChannel: "7" }));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.saveParams();
    });
    await vi.waitFor(() => expect(useArmedConfirmStore.getState().open).toBe(true));
    await act(async () => {
      useArmedConfirmStore.getState().cancel();
      await pending;
    });
    expect(setParameter).not.toHaveBeenCalled();
    useDroneStore.setState({ armState: "disarmed", connectionState: "disconnected" });
  });
});
