/**
 * A node's overview describes that node only. The browser holds one agent
 * connection; on another node's page the header shows that node's own
 * liveness, and the ground station and Visor overviews withhold the attached
 * node's status, services and Restart instead of showing them under this
 * node's name (and never fetch through that connection).
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cleanup, renderHook, screen } from "@testing-library/react";

vi.mock("@/components/command/nodes/ground-station/use-gs-poll", () => ({
  useGroundStationPoll: () => {},
  useAgentPoll: () => {},
}));

import messages from "../../../locales/en.json";
import { IntlWrapper, renderWithIntl } from "../../helpers/intl-wrapper";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useNodeBrand } from "@/components/dashboard/node-detail/node-brand";
import { GroundStationOverview } from "@/components/command/overview/GroundStationOverview";
import { VisorOverview } from "@/components/command/overview/VisorOverview";
import type { AgentStatus } from "@/lib/agent/types";

const ATTACHED = "node-a";
const OTHER = "node-b";

const connection = useAgentConnectionStore.getState();
const system = useAgentSystemStore.getState();
const fetchServices = vi.fn(async () => true);
const fetchResources = vi.fn(async () => true);
const fetchLogs = vi.fn(async () => {});

beforeEach(() => {
  fetchServices.mockClear();
  fetchResources.mockClear();
  fetchLogs.mockClear();
  // Node A's agent is attached, connected and reporting.
  useAgentConnectionStore.setState({
    nodeDeviceId: ATTACHED,
    agentUrl: "http://192.0.2.10:8080",
    apiKey: "key-a",
    connected: true,
  });
  useAgentSystemStore.setState({
    status: { version: "1.0.0", board: { name: "Attached board" } } as unknown as AgentStatus,
    services: [],
    fetchServices,
    fetchResources,
    fetchLogs,
  });
  useNodeRegistryStore.setState({ nodes: {} });
  useCommandFleetStore.setState({ cloudStatuses: {} } as never);
});

afterEach(() => {
  cleanup();
  useAgentConnectionStore.setState(connection, true);
  useAgentSystemStore.setState(system, true);
  useNodeRegistryStore.setState({ nodes: {} });
  useCommandFleetStore.setState({ cloudStatuses: {} } as never);
});

describe("node header status", () => {
  it("shows another node's own liveness, not the attached connection", () => {
    const { result } = renderHook(
      () => useNodeBrand({ profile: "drone", title: "B", nodeDeviceId: OTHER }),
      { wrapper: IntlWrapper },
    );
    expect(result.current.statusLine).toBe(messages.nodeConsole.hero.offline);
  });

  it("reads another node as online when it is heard from", () => {
    useCommandFleetStore.setState({
      cloudStatuses: { [OTHER]: { deviceId: OTHER, updatedAt: Date.now() } },
    } as never);
    const { result } = renderHook(
      () => useNodeBrand({ profile: "drone", title: "B", nodeDeviceId: OTHER }),
      { wrapper: IntlWrapper },
    );
    expect(result.current.statusLine).toBe(messages.nodeConsole.hero.online);
  });

  it("follows the connection on the attached node's own page", () => {
    const { result } = renderHook(
      () => useNodeBrand({ profile: "drone", title: "A", nodeDeviceId: ATTACHED }),
      { wrapper: IntlWrapper },
    );
    expect(result.current.statusLine).toBe(messages.nodeConsole.hero.online);
  });
});

describe("overview on another node's page", () => {
  it("ground station: withholds the attached node's status and never fetches through it", () => {
    renderWithIntl(<GroundStationOverview name="GS B" nodeDeviceId={OTHER} />);
    expect(screen.getByText(messages.agent.notAttached.title)).toBeTruthy();
    expect(screen.queryByText("Attached board")).toBeNull();
    expect(fetchServices).not.toHaveBeenCalled();
    expect(fetchLogs).not.toHaveBeenCalled();
  });

  it("Visor: withholds the attached node's status and never fetches through it", () => {
    renderWithIntl(<VisorOverview name="Visor B" nodeDeviceId={OTHER} />);
    expect(screen.getByText(messages.agent.notAttached.title)).toBeTruthy();
    expect(fetchServices).not.toHaveBeenCalled();
    expect(fetchLogs).not.toHaveBeenCalled();
  });
});
