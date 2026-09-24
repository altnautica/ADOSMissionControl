/**
 * @module node-detail/header-reboot.test
 * @description The header's Reboot FC control: disabled while the vehicle is
 * armed, asks before sending, and shows the flight controller's answer.
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, act } from "@testing-library/react";

const { toast } = vi.hoisted(() => {
  // The persisted ui-prefs store captures its storage at import, and
  // happy-dom's localStorage.setItem is not a function here.
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    },
  });
  return { toast: vi.fn() };
});

vi.mock("next-intl", () => ({
  useTranslations: () => Object.assign((k: string) => k, { rich: (k: string) => k }),
}));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/components/plugins/PluginHostProvider", () => ({
  PluginHostProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/plugins/DroneDetailTabHost", () => ({
  DroneDetailTabHeaders: () => null,
  DroneDetailTabBody: () => null,
  isPluginTabId: (id: string) => id.startsWith("plugin:"),
  pluginTabIds: () => [],
}));
vi.mock("@/hooks/use-plugin-contributions", () => ({ usePluginContributions: () => [] }));
vi.mock("@/hooks/use-drone-plugin-contributions", () => ({
  useDronePluginContributions: () => [],
  useLiveInstallRows: () => null,
}));
vi.mock("@/hooks/use-fleet-nodes", () => ({ useFleetNodes: () => [] }));
vi.mock("@/hooks/use-forget-node", () => ({ useForgetNode: () => vi.fn() }));
vi.mock("@/hooks/use-node-control-authority", () => ({
  useNodeControlAuthorityNotice: () => ({ show: false }),
}));
vi.mock("@/lib/utils", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  isDemoMode: () => true,
}));
vi.mock("@/components/indicators/NavStatePill", () => ({ NavStatePill: () => null }));
vi.mock("@/components/indicators/TrafficPill", () => ({ TrafficPill: () => null }));
vi.mock("@/components/indicators/ConnectionQualityMeter", () => ({
  ConnectionQualityMeter: () => null,
}));
vi.mock("../surfaces", () => ({
  resolveSurfaces: () => [{ id: "overview", labelKey: "overview", render: () => null }],
}));

import { NodeDetailPanel } from "../NodeDetailPanel";
import { useFleetStore } from "@/stores/fleet-store";
import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";
import { useDroneStore } from "@/stores/drone-store";
import type { FleetDrone } from "@/lib/types";
import type { DroneProtocol } from "@/lib/protocol/types";

const DRONE = "node:drone-1";
const reboot = vi.fn(async () => ({
  success: false,
  resultCode: 4,
  message: "Reboot refused: vehicle is armed",
}));

beforeEach(() => {
  reboot.mockClear();
  toast.mockClear();
  useFleetStore.setState({
    drones: [{ id: DRONE, name: DRONE, status: "online", profile: "drone" } as unknown as FleetDrone],
  });
  const protocol = { isConnected: true, reboot } as unknown as DroneProtocol;
  useDroneManager.setState({
    drones: new Map([
      [DRONE, { id: DRONE, protocol, vehicleInfo: { firmwareType: "betaflight" } } as unknown as ManagedDrone],
    ]),
    selectedDroneId: DRONE,
  });
});

afterEach(() => {
  cleanup();
  useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
});

const rebootButton = () => screen.getByRole("button", { name: "rebootFc" });

describe("header Reboot FC", () => {
  it("is disabled while the vehicle is armed", () => {
    useDroneStore.setState({ armState: "armed", connectionState: "connected" });
    render(<NodeDetailPanel droneId={DRONE} onClose={() => {}} />);
    expect((rebootButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(rebootButton());
    expect(screen.queryByText("rebootConfirm")).toBeNull();
    expect(reboot).not.toHaveBeenCalled();
  });

  it("asks first, then reports the FC's answer", async () => {
    useDroneStore.setState({ armState: "disarmed", connectionState: "connected" });
    render(<NodeDetailPanel droneId={DRONE} onClose={() => {}} />);
    fireEvent.click(rebootButton());
    expect(reboot).not.toHaveBeenCalled();
    expect(screen.getByText("rebootConfirm")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "reboot" }));
    });
    expect(reboot).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith("Reboot refused: vehicle is armed", "error");
  });
});
