/**
 * Render smoke test for SystemTab. Stubs the three sub-panels and the
 * disconnected fallback.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ connected: true }),
}));

vi.mock("@/components/command/AgentDisconnectedPage", () => ({
  AgentDisconnectedPage: () => <div data-testid="disconnected" />,
}));

vi.mock("@/components/command/system/HardwareStatusPanel", () => ({
  HardwareStatusPanel: () => <div data-testid="hardware-status-panel" />,
}));

vi.mock("@/components/command/system/ServicesPanel", () => ({
  ServicesPanel: () => <div data-testid="services-panel" />,
}));

vi.mock("@/components/command/system/FleetNetworkPanel", () => ({
  FleetNetworkPanel: () => <div data-testid="fleet-network-panel" />,
}));

vi.mock("@/components/command/system/RadioNetworkHealthPanel", () => ({
  RadioNetworkHealthPanel: () => <div data-testid="radio-network-health-panel" />,
}));

vi.mock("@/components/command/system/RegulatoryRegionPanel", () => ({
  RegulatoryRegionPanel: () => <div data-testid="regulatory-region-panel" />,
}));

vi.mock("@/components/command/system/SoftwareUpdateCard", () => ({
  SoftwareUpdateCard: () => <div data-testid="software-update-card" />,
}));

vi.mock("@/components/command/system/PluginHardwarePanels", () => ({
  PluginHardwarePanels: () => <div data-testid="plugin-hardware-panels" />,
}));

import { SystemTab } from "@/components/command/SystemTab";

describe("SystemTab", () => {
  it("renders the three sub-panels when connected", () => {
    const { getByTestId } = render(<SystemTab nodeDeviceId="node-1" />);
    expect(getByTestId("hardware-status-panel")).toBeTruthy();
    expect(getByTestId("services-panel")).toBeTruthy();
    expect(getByTestId("fleet-network-panel")).toBeTruthy();
  });
});
