/**
 * @license GPL-3.0-only
 *
 * Forgetting a paired Bluetooth controller asks first, naming the device, and
 * reports a failure instead of doing nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "../../../../../tests/helpers/intl-wrapper";
import InputDevicesPage from "../page";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useGroundStationStore } from "@/stores/ground-station-store";

const toast = vi.fn();
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/hardware/BluetoothPairModal", () => ({ BluetoothPairModal: () => null }));
vi.mock("@/components/hardware/ControllersSection", () => ({ ControllersSection: () => null }));
vi.mock("@/components/config/SkillBindingsSection", () => ({ SkillBindingsSection: () => null }));
vi.mock("@/components/config/ControlsSettings", () => ({ ControlsSettings: () => null }));
vi.mock("@/lib/api/ground-station-api", () => ({ groundStationApiFromAgent: () => ({}) }));

const forget = vi.fn(async () => false);

beforeEach(() => {
  toast.mockClear();
  forget.mockClear();
  useAgentConnectionStore.setState({ agentUrl: "http://agent.local:8080", apiKey: "k" });
  useGroundStationStore.setState({
    bluetooth: { ...useGroundStationStore.getState().bluetooth, paired: [{ mac: "AA:BB", name: "Wireless Gamepad" }] },
    loadGamepads: vi.fn(async () => {}),
    loadPairedBluetooth: vi.fn(async () => {}),
    forgetBluetooth: forget,
  } as never);
});

describe("Paired Bluetooth › Forget", () => {
  it("confirms naming the device, then reports a failure", async () => {
    renderWithIntl(<InputDevicesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));
    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByText("Forget Wireless Gamepad?")).toBeTruthy();
    const buttons = screen.getAllByRole("button", { name: "Forget" });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(forget).toHaveBeenCalled());
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Could not forget Wireless Gamepad", "error"));
  });
});
