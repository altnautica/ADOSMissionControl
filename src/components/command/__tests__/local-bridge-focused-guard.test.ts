/**
 * @license GPL-3.0-only
 *
 * CommandFleetLocalBridge drops a LAN-paired node whose hostname now answers
 * as a different (or unpaired) agent, except the node the operator is focused
 * on: that one stays so the detail panel can offer re-pair / remove. The poll
 * loop also arms its next tick only after the previous one settles, so a slow
 * agent never stacks overlapping probes.
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
  return { probeAgent: vi.fn<(hostname: string) => Promise<unknown>>() };
});

vi.mock("@/lib/agent/local-pair-client", () => ({
  probeAgent: (hostname: string) => h.probeAgent(hostname),
}));

import { CommandFleetLocalBridge } from "../CommandFleetLocalBridge";
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

/** A reachable agent that now reports a different device id. */
function reassignedProbe() {
  return Promise.resolve({
    deviceId: "cccc3333",
    name: "other",
    version: "1",
    board: "x",
    paired: true,
    mdnsHost: "other.local",
    profile: "drone",
    hostname: "http://192.168.1.52:8080",
  });
}

beforeEach(() => {
  h.probeAgent.mockReset();
  useLocalNodesStore.setState({ nodes: [localNode(FOCUSED), localNode(BACKGROUND)] });
  usePairingStore.setState({ selectedPairedId: nodeIdForDevice(FOCUSED) });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CommandFleetLocalBridge stale-identity self-heal", () => {
  it("drops a background stale node but keeps the focused one", async () => {
    h.probeAgent.mockImplementation(reassignedProbe);
    render(createElement(CommandFleetLocalBridge, { enabled: true }));

    await waitFor(() => {
      const ids = useLocalNodesStore.getState().nodes.map((n) => n.deviceId);
      expect(ids).not.toContain(BACKGROUND);
    });
    const ids = useLocalNodesStore.getState().nodes.map((n) => n.deviceId);
    expect(ids).toContain(FOCUSED);
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
