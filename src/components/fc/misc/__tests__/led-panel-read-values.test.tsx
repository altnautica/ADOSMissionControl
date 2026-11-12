/**
 * @license GPL-3.0-only
 *
 * The LED panel builds its controls only from values read from the vehicle.
 * Before the read lands there is nothing to tick and nothing to save, and a
 * ticked bit adds to the vehicle's own mask rather than to a default of 0.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "../../../../../tests/helpers/intl-wrapper";

vi.mock("@/lib/param-cache-idb", () => ({
  cachePanelToIDB: () => Promise.resolve(),
  getCachedPanelFromIDB: () => Promise.resolve(null),
}));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import type { DroneProtocol, ParameterValue } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import { usePanelCacheStore } from "@/stores/panel-cache-store";
import { LedPanel } from "../LedPanel";

function connect(getParameter: (name: string) => Promise<ParameterValue>) {
  const setParameter = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));
  const protocol = {
    isConnected: true,
    getParameter,
    setParameter,
    getFirmwareHandler: () => null,
  } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
  useDroneStore.setState({ connectionState: "connected", armState: "disarmed" });
  return setParameter;
}

const VALUES: Record<string, number> = { NTF_LED_TYPES: 0b101, NTF_LED_LEN: 4, NTF_LED_BRIGHT: 2 };
const answer = async (name: string): Promise<ParameterValue> => {
  if (!(name in VALUES)) throw Object.assign(new Error("absent"), { code: "param_absent" });
  return { name, value: VALUES[name], type: 9, index: 0, count: 1 } as ParameterValue;
};

const saveButton = () => screen.getByRole("button", { name: /save to flight controller/i }) as HTMLButtonElement;

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useDroneStore.setState({ connectionState: "disconnected", armState: "unknown" });
  usePanelCacheStore.getState().clear();
});

describe("LedPanel before and after the read", () => {
  it("shows no LED controls while the read is in flight", () => {
    connect(() => new Promise<ParameterValue>(() => {}));
    render(<LedPanel />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "High" })).toBeNull();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    expect(screen.getAllByText("not read").length).toBeGreaterThan(0);
    expect(saveButton().disabled).toBe(true);
  });

  it("ticks a bit into the mask the vehicle reported", async () => {
    const setParameter = connect(answer);
    render(<LedPanel />);
    await waitFor(() => expect(screen.getAllByRole("checkbox")).toHaveLength(11));
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked).slice(0, 3)).toEqual([true, false, true]);
    fireEvent.click(boxes[1]);
    await act(async () => { fireEvent.click(saveButton()); });
    expect(setParameter).toHaveBeenCalledWith("NTF_LED_TYPES", 0b111);
  });
});
