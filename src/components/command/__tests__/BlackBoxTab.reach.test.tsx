/**
 * @license GPL-3.0-only
 *
 * The Recorder on a node the GCS does not reach directly: a relayed drone
 * reads its store through the ground station's relay-proxy, and a node with
 * no reach at all says it is unreachable instead of "connecting" forever.
 * Offline is judged from this node's own reach and freshness, never from the
 * attached connection, which may be another node's.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../locales/en.json";

vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/use-convex-skip-query", () => ({ useConvexSkipQuery: () => undefined }));
vi.mock("convex/react", () => ({ useAction: () => vi.fn() }));

const built: { baseUrl: string; opts: unknown }[] = [];
vi.mock("@/lib/agent/client", () => ({
  AgentClient: class {
    logging = {
      sessions: vi.fn(async () => ({ data: [], page: { next_cursor: null, count: 0 }, meta: {} })),
      query: vi.fn(async () => ({ data: [], page: { next_cursor: null, count: 0 }, meta: {} })),
      aggregate: vi.fn(async () => ({ data: [], page: { next_cursor: null, count: 0 }, meta: {} })),
      healthz: vi.fn(async () => ({ ok: true, db_open: true, writer_alive: true, integrity: true, source: "logd" })),
      stats: vi.fn(async () => null),
    };
    constructor(baseUrl: string, _key: string, opts: unknown) {
      built.push({ baseUrl, opts });
    }
  },
}));

import { BlackBoxTab } from "../BlackBoxTab";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useBlackBoxStore } from "@/stores/blackbox-store";
import { useAgentSystemStore } from "@/stores/agent-system-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import type { RelayReach } from "@/lib/nodes/relay-reach";

const reach: RelayReach = { baseUrl: "http://192.0.2.60:8080", apiKey: "gs", peerDeviceId: "drone_9" };
const connection = useAgentConnectionStore.getState();
const system = useAgentSystemStore.getState();
const offlineTitle = messages.linkUp["agent-offline"].title;

async function renderTab(props: { directReach?: boolean; relayReach?: RelayReach | null }) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <BlackBoxTab nodeDeviceId="drone_9" {...props} />
    </NextIntlClientProvider>,
  );
  await act(async () => {});
}

beforeEach(() => {
  built.length = 0;
  useBlackBoxStore.getState().clear();
  // Another node is the attached connection.
  useAgentConnectionStore.setState({ nodeDeviceId: "other", agentUrl: "http://192.0.2.2:8080", client: null, cloudMode: false });
});
afterEach(() => {
  cleanup();
  useAgentConnectionStore.setState(connection, true);
  useAgentSystemStore.setState(system, true);
  useNodeRegistryStore.setState({ nodes: {} });
});

describe("BlackBoxTab reach", () => {
  it("reads a relayed drone through its ground station's relay-proxy", async () => {
    await renderTab({ directReach: false, relayReach: reach });
    expect(built).toEqual([
      { baseUrl: "http://192.0.2.60:8080/api/v1/ground-station/relay-proxy/drone_9", opts: { relay: true } },
    ]);
    expect(screen.queryByText(messages.blackbox.connecting)).toBeNull();
  });

  it("says an unreachable node is unreachable", async () => {
    await renderTab({ directReach: false, relayReach: null });
    expect(screen.getByText(messages.blackbox.unreachable)).toBeTruthy();
    expect(screen.queryByText(messages.blackbox.connecting)).toBeNull();
  });

  it("still waits while a direct connection is coming", async () => {
    await renderTab({ directReach: true });
    expect(screen.getByText(messages.blackbox.connecting)).toBeTruthy();
  });

  it("reads a relayed drone while the attached link is down", async () => {
    useAgentConnectionStore.setState({ connected: false });
    await renderTab({ directReach: false, relayReach: reach });
    expect(screen.getByText(messages.blackbox.title)).toBeTruthy();
    expect(screen.queryByText(offlineTitle)).toBeNull();
  });

  it("never marks a relayed drone offline because the attached node went quiet", async () => {
    useAgentConnectionStore.setState({ connected: true });
    useAgentSystemStore.setState({ lastUpdatedAt: Date.now() - 120_000 });
    await renderTab({ directReach: false, relayReach: reach });
    expect(screen.queryByText(offlineTitle)).toBeNull();
    expect(screen.getByText(messages.blackbox.title)).toBeTruthy();
  });

  it("says a quiet node is offline from its own last heartbeat, not the attached node's", async () => {
    useAgentConnectionStore.setState({ connected: true });
    useAgentSystemStore.setState({ lastUpdatedAt: Date.now() });
    useNodeRegistryStore.setState({
      nodes: {
        "node:drone_9": { presence: { lastHeartbeat: Date.now() - 120_000, sources: [] }, fc: {} },
      } as never,
    });
    await renderTab({ directReach: true });
    expect(screen.getByText(offlineTitle)).toBeTruthy();
    expect(screen.getByText(/Last update 2m ago/)).toBeTruthy();
  });
});
