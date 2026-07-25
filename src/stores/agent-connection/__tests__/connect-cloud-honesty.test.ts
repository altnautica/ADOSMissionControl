/**
 * @license GPL-3.0-only
 *
 * connectCloud subscribes to the relay. It does not reach the node, and it must
 * not report that it did. Two claims used to be made at the moment of the call:
 * that the agent was connected, and that its data had no age. Both were made
 * with no client, no request, and no heartbeat. The second one was the visible
 * one: pressing Reconnect on a stale node blanked the freshness clock, which
 * every consumer reads as live-neutral, so hours old telemetry repainted as
 * current and the stale banner disappeared.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// Persisted local-nodes-store: bind an in-memory localStorage before import.
vi.hoisted(() => {
  const mem = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
      clear: () => mem.clear(),
      key: () => null,
      get length() {
        return mem.size;
      },
    },
  });
});

import { useAgentConnectionStore } from "../index";
import { useAgentSystemStore } from "../../agent-system-store";
import { useLocalNodesStore } from "../../local-nodes-store";
import { getFreshness, OFFLINE_THRESHOLD_MS } from "@/lib/agent/freshness";

const DEVICE = "dev-cloud-1";

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  useAgentSystemStore.setState({ lastUpdatedAt: null, stale: false });
  useAgentConnectionStore.setState({
    connected: false,
    client: null,
    agentUrl: null,
    apiKey: null,
    cloudMode: false,
    cloudDeviceId: null,
    lastCloudUpdate: null,
    connectionError: null,
  });
});

describe("connectCloud — no transport, no claim of one", () => {
  it("does not report connected while no client and no credentials exist", () => {
    useAgentConnectionStore.getState().connectCloud(DEVICE);

    const state = useAgentConnectionStore.getState();
    expect(state.cloudMode).toBe(true);
    expect(state.cloudDeviceId).toBe(DEVICE);
    // The three things a real link would need, all absent.
    expect(state.client).toBeNull();
    expect(state.agentUrl).toBeNull();
    expect(state.apiKey).toBeNull();
    // So the link is not claimed.
    expect(state.connected).toBe(false);
  });

  it("still reports not connected when only a cached LAN url is known", () => {
    // A cached pairing gives the transport cascade somewhere to aim. It is not
    // evidence that anything answered.
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: DEVICE,
          name: "Rig",
          hostname: "http://192.168.0.5:8080",
          apiKey: "key",
          profile: "drone",
          pairedAt: 1,
        },
      ],
    });

    useAgentConnectionStore.getState().connectCloud(DEVICE);

    const state = useAgentConnectionStore.getState();
    expect(state.agentUrl).toBe("http://192.168.0.5:8080");
    expect(state.connected).toBe(false);
  });
});

describe("connectCloud — the freshness clock is not reset", () => {
  it("keeps an offline node reading offline until a heartbeat lands", () => {
    // The reconnect path: last readings are on screen and long past offline.
    const lastSeen = Date.now() - OFFLINE_THRESHOLD_MS - 60_000;
    useAgentSystemStore.setState({ lastUpdatedAt: lastSeen, stale: true });

    useAgentConnectionStore.getState().connectCloud(DEVICE);

    const { lastUpdatedAt, stale } = useAgentSystemStore.getState();
    expect(lastUpdatedAt).toBe(lastSeen);
    expect(stale).toBe(true);
    // "unknown" is the state every consumer treats as live-neutral, so the
    // banner would vanish and the readings would render bright.
    expect(getFreshness(lastUpdatedAt).state).toBe("offline");
  });

  it("does not stamp a heartbeat time the agent never sent", () => {
    const lastSeen = Date.now() - OFFLINE_THRESHOLD_MS - 60_000;
    useAgentConnectionStore.setState({ lastCloudUpdate: lastSeen });

    useAgentConnectionStore.getState().connectCloud(DEVICE);

    // The staleness watchdog measures elapsed time from this value. Moving it
    // to now would buy a full threshold of silence back and then seed the
    // freshness clock from the invented time.
    expect(useAgentConnectionStore.getState().lastCloudUpdate).toBe(lastSeen);
  });

  it("leaves a node with no readings at all reading unknown", () => {
    // disconnect() clears the system store, so a switch to a new node starts
    // with no timestamp and nothing on screen to mislabel.
    useAgentConnectionStore.getState().connectCloud(DEVICE);

    expect(useAgentSystemStore.getState().lastUpdatedAt).toBeNull();
    expect(getFreshness(null).state).toBe("unknown");
  });
});
