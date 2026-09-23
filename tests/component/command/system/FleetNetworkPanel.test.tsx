/**
 * FleetNetworkPanel shows the broker the fleet bridges dial and the result of
 * a connection test, and renders no peer roster when the agent reports none.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../helpers/intl-wrapper";

vi.mock("@/stores/agent-connection-store", () => ({
  useAgentConnectionStore: (sel: (s: unknown) => unknown) =>
    sel({ connected: false, mqttConnected: false }),
}));

vi.mock("@/stores/fleet-network-store", () => ({
  useFleetNetworkStore: (sel: (s: unknown) => unknown) =>
    sel({
      peers: [],
      fetchPeers: vi.fn(),
    }),
}));

vi.mock("@/hooks/use-mqtt-broker-test", () => ({
  useMqttBrokerTest: () => ({
    brokerUrl: "wss://broker.example.com/mqtt",
    testConnection: vi.fn(),
    isTesting: false,
    lastResult: { ok: false, message: "Connection test timed out", at: 1 },
  }),
}));

vi.mock("@/components/command/system/shared", () => ({
  CollapsibleSection: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <section data-testid="collapsible" data-title={title}>
      {children}
    </section>
  ),
}));

import { FleetNetworkPanel } from "@/components/command/system/FleetNetworkPanel";

describe("FleetNetworkPanel", () => {
  it("shows the dialled broker and the last test result", () => {
    renderWithIntl(<FleetNetworkPanel />);
    expect(screen.getByText("wss://broker.example.com/mqtt")).toBeDefined();
    expect(screen.getByText("Connection test timed out")).toBeDefined();
  });

  it("renders no peer roster when the agent reports no peers", () => {
    renderWithIntl(<FleetNetworkPanel />);
    expect(screen.queryByText("ADOS Peers")).toBeNull();
  });
});
