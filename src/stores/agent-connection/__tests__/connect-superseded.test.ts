/**
 * @license GPL-3.0-only
 *
 * A connect that is still waiting on its agent when the operator moves on (a
 * second connect to another node, or a disconnect) must leave the connection
 * state alone when it finally answers: the late answer belongs to a node the
 * operator already left.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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

interface Gate {
  promise: Promise<Record<string, unknown>>;
  resolve: (status: Record<string, unknown>) => void;
}

const gates = new Map<string, Gate>();

function gateFor(url: string): Gate {
  let gate = gates.get(url);
  if (!gate) {
    const { promise, resolve } = Promise.withResolvers<Record<string, unknown>>();
    gate = { promise, resolve };
    gates.set(url, gate);
  }
  return gate;
}

vi.mock("@/lib/agent/client", () => ({
  AgentClient: class {
    constructor(private readonly url: string) {}
    getStatus() {
      return gateFor(this.url).promise;
    }
  },
  normaliseSystemResources: (x: unknown) => x,
}));

import { useAgentConnectionStore } from "../index";
import { useAgentSystemStore } from "../../agent-system-store";
import type { AgentClient } from "@/lib/agent/client";

const HOST_A = "http://192.168.1.50:8080";
const HOST_B = "http://192.168.1.51:8080";

beforeEach(() => {
  gates.clear();
  useAgentConnectionStore.getState().disconnect();
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("no net")));
});

afterEach(() => {
  useAgentConnectionStore.getState().disconnect();
  vi.unstubAllGlobals();
});

describe("connect() superseded by a later action", () => {
  it("a late answer from the previous node does not take over the new node's connection", async () => {
    const first = useAgentConnectionStore.getState().connect(HOST_A, "key-a", "node-a");
    const second = useAgentConnectionStore.getState().connect(HOST_B, "key-b", "node-b");
    gateFor(HOST_B).resolve({ marker: "b" });
    await second;

    gateFor(HOST_A).resolve({ marker: "a" });
    await first;

    const s = useAgentConnectionStore.getState();
    expect(s.connected).toBe(true);
    expect(s.nodeDeviceId).toBe("node-b");
    expect(s.agentUrl).toBe(HOST_B);
    expect(useAgentSystemStore.getState().status).toEqual({ marker: "b" });
  });

  it("a disconnect during the connect keeps the connection closed", async () => {
    const pending = useAgentConnectionStore.getState().connect(HOST_A, "key-a", "node-a");
    useAgentConnectionStore.getState().disconnect();

    gateFor(HOST_A).resolve({ marker: "a" });
    await pending;

    const s = useAgentConnectionStore.getState();
    expect(s.connected).toBe(false);
    expect(s.nodeDeviceId).toBeNull();
    expect(s.pollInterval).toBeNull();
    expect(useAgentSystemStore.getState().status).toBeNull();
  });
});


describe("agent-system fetches across a node switch", () => {
  it("drops a resources reading that lands after the client changed", async () => {
    const { promise, resolve } = Promise.withResolvers<{ cpu_percent: number; memory_percent: number }>();
    useAgentSystemStore.getState().clear();
    useAgentConnectionStore.setState({
      client: { getSystemResources: () => promise } as Partial<AgentClient> as AgentClient,
      cloudMode: false,
    });
    const pending = useAgentSystemStore.getState().fetchResources();

    useAgentConnectionStore.setState({
      client: { getSystemResources: () => promise } as Partial<AgentClient> as AgentClient,
    });
    resolve({ cpu_percent: 91, memory_percent: 40 });

    expect(await pending).toBe(false);
    const system = useAgentSystemStore.getState();
    expect(system.resources).toBeNull();
    expect(system.cpuHistory).toEqual([]);
  });
});