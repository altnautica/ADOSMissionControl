/**
 * @license GPL-3.0-only
 *
 * After a failed read the Flight Modes panel shows the modes as not read,
 * never six default slots that look like the vehicle's, and Save stays off
 * until a read succeeds.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import { IntlWrapper, renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import { ArduCopterHandler } from "@/lib/protocol/firmware/ardupilot";
import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { FlightModesPanel } from "../FlightModesPanel";
import { useFlightModeParams } from "../use-flight-mode-params";

const handler = new ArduCopterHandler();

function connect(getParameter: (name: string) => Promise<ParameterValue>) {
  const protocol = {
    isConnected: true,
    getFirmwareHandler: () => handler,
    getParameter,
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
}

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

describe("FlightModesPanel after a read", () => {
  it("shows the modes as not read after a failed read", async () => {
    connect(async () => { throw new Error("timeout"); });
    await act(async () => { renderWithIntl(<FlightModesPanel />); });
    await screen.findByText(messages.fcPanels.flightModesPanel.readFailed);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
  });

  it("shows the slots once a read succeeds", async () => {
    connect(async (name) => ({ name, value: name === "FLTMODE_CH" ? 5 : 0, type: 9, index: 0, count: 1 }) as ParameterValue);
    await act(async () => { renderWithIntl(<FlightModesPanel />); });
    await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0));
    expect(screen.queryByText(messages.fcPanels.flightModesPanel.readFailed)).toBeNull();
  });

  it("writes nothing after a failed read", async () => {
    const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
    const protocol = {
      getParameter: async () => { throw new Error("timeout"); },
      setParameter,
    } as Partial<DroneProtocol> as DroneProtocol;
    const { result } = renderHook(
      () => useFlightModeParams({ protocol, firmwareHandler: handler, isCopter: true, toast: vi.fn() }),
      { wrapper: IntlWrapper },
    );
    await act(async () => { await result.current.fetchParams(); });
    act(() => result.current.updateGlobal({ modeChannel: "7" }));
    await act(async () => { await result.current.saveParams(); });
    expect(setParameter).not.toHaveBeenCalled();
    expect(result.current.loaded).toBe(false);
  });
});
