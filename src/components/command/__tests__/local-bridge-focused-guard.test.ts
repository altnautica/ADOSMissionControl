/**
 * @license GPL-3.0-only
 *
 * CommandFleetLocalBridge and a LAN-paired node whose stored address stops
 * answering as that node:
 *  - another agent answers there → the node and its key are kept and marked
 *    `hostTakenBy` (its key exists nowhere else);
 *  - the agent itself reports it is unpaired → a background card is dropped,
 *    the focused one stays so the detail panel can offer re-pair / remove.
 * A node that answers its status call by refusing this browser's key is alive:
 * presence is stamped and `keyRejectedAt` set, never left to go offline.
 * The poll loop arms its next tick only after the previous one settles.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => {
  // Persisted local-nodes-store: bind an in-memory localStorage before import.
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
      get length() {
        return mem.size;
      },
    },
  });
  return {
    probeAgent: vi.fn<(hostname: string) => Promise<unknown>>(),
    getFullStatus: vi.fn<() => Promise<unknown>>(),
  };
});

vi.mock("@/lib/agent/local-pair-client", () => ({
  probeAgent: (hostname: string) => h.probeAgent(hostname),
}));

vi.mock("@/lib/agent/agent-client/client", () => ({
  AgentClient: class {
    getFullStatus() {
      return h.getFullStatus();
    }
  },
}));

import { CommandFleetLocalBridge } from "../CommandFleetLocalBridge";
import { AgentHttpError } from "@/lib/agent/agent-client/transport";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import { nodeIdForDevice } from "@/lib/agent/node-id";

const FOCUSED = "aaaa1111";
const BACKGROUND = "bbbb2222";

function localNode(deviceId: string): LocalNode {
  return {
    deviceId,
    name: deviceId,
    hostname: `http://192.168.1.${deviceId === FOCUSED ? 50 : 51}:8080`,
    apiKey: "key",
    profile: "drone",
    pairedAt: 1,
  };
}

function probe(deviceId: string, paired: boolean) {
  return Promise.resolve({
    deviceId,
    name: "agent",
    version: "1",
    board: "x",
    paired,
    mdnsHost: "agent.local",
    profile: "drone",
    hostname: "http://192.168.1.52:8080",
  });
}

function node(deviceId: string): LocalNode | undefined {
  return useLocalNodesStore.getState().nodes.find((n) => n.deviceId === deviceId);
}

beforeEach(() => {
  h.probeAgent.mockReset();
  h.getFullStatus.mockReset();
  h.getFullStatus.mockResolvedValue(null);
  useLocalNodesStore.setState({ nodes: [localNode(FOCUSED), localNode(BACKGROUND)] });
  usePairingStore.setState({ selectedPairedId: nodeIdForDevice(FOCUSED) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CommandFleetLocalBridge identity checks", () => {
  it("keeps a node whose address now answers as another agent, and marks it", async () => {
    h.probeAgent.mockImplementation(() => probe("cccc3333", true));
    render(createElement(CommandFleetLocalBridge, { enabled: true }));

    await waitFor(() => {
      expect(node(BACKGROUND)?.hostTakenBy?.deviceId).toBe("cccc3333");
    });
    expect(node(BACKGROUND)?.apiKey).toBe("key");
    expect(node(FOCUSED)?.hostTakenBy?.deviceId).toBe("cccc3333");
    expect(h.getFullStatus).not.toHaveBeenCalled();
  });

  it("drops a background node the agent reports unpaired but keeps the focused one", async () => {
    h.probeAgent.mockImplementation((hostname) =>
      probe(hostname.includes(".50:") ? FOCUSED : BACKGROUND, false),
    );
    render(createElement(CommandFleetLocalBridge, { enabled: true }));

    await waitFor(() => {
      expect(node(BACKGROUND)).toBeUndefined();
    });
    expect(node(FOCUSED)).toBeDefined();
  });

  it("does not start another probe while the previous one is still pending", async () => {
    vi.useFakeTimers();
    useLocalNodesStore.setState({ nodes: [localNode(FOCUSED)] });
    h.probeAgent.mockImplementation(() => Promise.withResolvers<unknown>().promise);
    render(createElement(CommandFleetLocalBridge, { enabled: true }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(h.probeAgent).toHaveBeenCalledTimes(1);
  });
});

describe("CommandFleetLocalBridge key refusal", () => {
  it.each([401, 403])("treats a %i on status as alive with its key rejected", async (status) => {
    useLocalNodesStore.setState({ nodes: [localNode(FOCUSED)] });
    h.probeAgent.mockImplementation(() => probe(FOCUSED, true));
    h.getFullStatus.mockRejectedValue(new AgentHttpError(status, "{}"));
    render(createElement(CommandFleetLocalBridge, { enabled: true }));

    await waitFor(() => {
      expect(node(FOCUSED)?.keyRejectedAt).toBeTypeOf("number");
    });
    expect(node(FOCUSED)?.lastSeenAt).toBeTypeOf("number");
  });
});
