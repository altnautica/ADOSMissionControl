/**
 * @license GPL-3.0-only
 *
 * Ports › Reboot flight controller and Scripts › Reboot flight controller go
 * through the shared reboot control: nothing is sent on the first click, the
 * control is disabled while the vehicle may be armed, and a refusal is
 * reported in the operator's language.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IntlWrapper } from "../../../../../tests/helpers/intl-wrapper";
import messages from "../../../../../locales/en.json";
import type { DroneProtocol } from "@/lib/protocol/types";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/hooks/use-firmware-capabilities", () => ({
  useFirmwareCapabilities: () => ({ firmwareType: "ardupilot-copter" }),
}));
vi.mock("@/hooks/use-panel-params", () => ({
  usePanelParams: () => ({
    params: new Map([["SERIAL1_PROTOCOL", 2], ["SERIAL1_BAUD", 57], ["SCR_ENABLE", 1]]),
    loading: false, error: null, dirtyParams: new Set(["SERIAL1_BAUD"]), hasRamWrites: false,
    loadProgress: null, hasLoaded: true, missingOptional: new Set(),
    refresh: vi.fn(), setLocalValue: vi.fn(), saveAllToRam: vi.fn(), commitToFlash: vi.fn(), revertAll: vi.fn(),
  }),
}));
vi.mock("@/hooks/use-param-panel-actions", () => ({
  useParamPanelActions: () => ({ saving: false, flashing: false, save: async () => true, flash: vi.fn() }),
}));

import { PortsPanel } from "../../comms/PortsPanel";
import { ScrConfigCard } from "@/components/dashboard/drone-scripts/ScrConfigCard";

const reboot = vi.fn(async () => ({ success: true, resultCode: 0, message: "" }));

beforeEach(() => {
  reboot.mockReset();
  reboot.mockResolvedValue({ success: true, resultCode: 0, message: "" });
  toast.mockReset();
  const protocol = { isConnected: true, reboot, getFirmwareHandler: () => null } as Partial<DroneProtocol> as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([["d1", { id: "d1", name: "d1", protocol } as Partial<ManagedDrone> as ManagedDrone]]),
    selectedDroneId: "d1",
  });
});

afterEach(() => {
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
  useDroneStore.setState({ armState: "unknown", connectionState: "disconnected" });
});

const rebootTrigger = () => screen.getByRole("button", { name: messages.droneDetail.rebootFc }) as HTMLButtonElement;
const confirm = () => screen.getByRole("button", { name: messages.dronePanel.reboot });

async function openPorts() {
  render(<PortsPanel />, { wrapper: IntlWrapper });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: messages.fcPanels.portsPanel.saveChanges }));
  });
}

describe("Ports › Reboot flight controller", () => {
  it("asks before rebooting", async () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    await openPorts();
    fireEvent.click(rebootTrigger());
    expect(reboot).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(confirm()); });
    expect(reboot).toHaveBeenCalledTimes(1);
  });

  it("is disabled while the arm state is unknown", async () => {
    useDroneStore.setState({ armState: "unknown", connectionState: "connected" });
    await openPorts();
    expect(rebootTrigger().disabled).toBe(true);
  });

  it("labels pending edits in the operator's language", async () => {
    render(<PortsPanel />, { wrapper: IntlWrapper });
    expect(screen.queryByText("UNSAVED")).toBeNull();
    expect(screen.getByText(messages.panelCommit.bar.unsavedChanges)).toBeTruthy();
  });
});

describe("Scripts › Reboot flight controller", () => {
  it("asks before rebooting and reports a refusal with a localised fallback", async () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    reboot.mockResolvedValue({ success: false, resultCode: 4, message: "" });
    render(<ScrConfigCard />, { wrapper: IntlWrapper });
    fireEvent.click(rebootTrigger());
    expect(reboot).not.toHaveBeenCalled();
    await act(async () => { fireEvent.click(confirm()); });
    expect(reboot).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(messages.dashboard.scrConfigCard.rebootRefused, "error");
  });

  it("is disabled while the vehicle is armed", () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    render(<ScrConfigCard />, { wrapper: IntlWrapper });
    expect(rebootTrigger().disabled).toBe(true);
  });
});
