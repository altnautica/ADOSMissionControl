/**
 * A plugin's agent-extended telemetry channel reaches a node-bound mount on
 * any node profile: through the node's own state route, or, signed in, the
 * node's fresh heartbeat slice; and one poll per (node, plugin) runs only
 * while a mount subscribes.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Persisted local-nodes-store: bind an in-memory localStorage before import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      length: 0,
    },
  });
});

import { useAuthStore } from "@/stores/auth-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePluginCloudStateStore } from "@/stores/plugin-cloud-state-store";
import type { BridgeHandlerContext } from "@/lib/plugins/bridge";
import { AGENT_STATE_POLL_MS, acquireAgentStateFeed } from "../agent-state-feed";
import { buildTelemetryHandlers } from "../handlers/telemetry";
import { resolvePluginTarget } from "../handlers/target";
import { testMount } from "../handlers/__tests__/test-mount";

const PLUGIN_ID = "com.example.world";
const WS = "ws-1";

const fetchMock = vi.fn<typeof fetch>();

function stateBody(ts: number, payload: unknown): Response {
  return new Response(JSON.stringify({ "telemetry.status": { payload, ts_ms: ts } }), {
    status: 200,
  });
}

function subscribeStatus() {
  const { handlers, dispose } = buildTelemetryHandlers(PLUGIN_ID, resolvePluginTarget(WS));
  const postEvent = vi.fn();
  const ctx: BridgeHandlerContext = {
    pluginId: PLUGIN_ID,
    capability: "telemetry.subscribe.status",
    postEvent,
    mount: testMount(),
    claims: null,
  };
  void handlers["telemetry.subscribe"]({ topic: "status" }, ctx);
  return { postEvent, dispose };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  useLocalNodesStore.setState({
    nodes: [
      {
        deviceId: WS,
        name: "bench",
        hostname: "http://192.168.1.30:8080",
        apiKey: "key-ws",
        profile: "workstation",
        pairedAt: 0,
      },
    ],
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useAuthStore.setState({ isAuthenticated: false });
  usePluginCloudStateStore.setState({ byDevice: {}, updatedAt: {} });
  useLocalNodesStore.setState({ nodes: [] });
});

describe("agent-extended telemetry on a node-bound mount", () => {
  it("delivers a workstation's `status` channel from the node's state route", async () => {
    fetchMock.mockImplementation(async () => stateBody(1, { jobs: 2 }));
    const { postEvent, dispose } = subscribeStatus();
    await vi.waitFor(() =>
      expect(postEvent).toHaveBeenCalledWith("telemetry.status", "telemetry.subscribe.status", {
        jobs: 2,
      }),
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      `http://192.168.1.30:8080/api/plugins/${PLUGIN_ID}/state`,
    );
    dispose();
  });

  it("uses the node's fresh heartbeat slice when signed in, without polling the node", async () => {
    useAuthStore.setState({ isAuthenticated: true });
    usePluginCloudStateStore.getState().setForDevice(
      WS,
      { [PLUGIN_ID]: { "telemetry.status": { payload: { jobs: 5 }, ts_ms: 9 } } },
      Date.now(),
    );
    const { postEvent, dispose } = subscribeStatus();
    await vi.waitFor(() =>
      expect(postEvent).toHaveBeenCalledWith("telemetry.status", "telemetry.subscribe.status", {
        jobs: 5,
      }),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    dispose();
  });

  it("runs one poll per (node, plugin) and stops when the last holder lets go", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async () => stateBody(1, {}));
    const releaseA = acquireAgentStateFeed(PLUGIN_ID, WS);
    const releaseB = acquireAgentStateFeed(PLUGIN_ID, WS);
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS * 2);
    // The immediate read plus one per interval: shared, not doubled.
    expect(fetchMock).toHaveBeenCalledTimes(3);

    releaseA();
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    releaseB();
    await vi.advanceTimersByTimeAsync(AGENT_STATE_POLL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
