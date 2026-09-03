/**
 * @license GPL-3.0-only
 *
 * selectNode used to send every non-local node to the cloud relay, and then
 * to refuse a relayed node outright. Neither is right. A node enrolled solely
 * through another node's radio was never paired with the GCS, so subscribing
 * under its device id waits on a row that will never exist — but when the
 * ground station it hangs off IS paired on this browser, that ground station's
 * relay-proxy route reaches the drone's own agent API, and the connection must
 * open against it. Only an unreachable ground station is a refusal.
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

import { selectNode } from "../node-click-handler";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";

const DEV = "drone-x";

function node(over: Partial<FleetNodeEntry> = {}): FleetNodeEntry {
  return {
    _id: `node:${DEV}`,
    userId: "relayed",
    deviceId: DEV,
    name: "Drone X",
    apiKey: "",
    pairedAt: 1,
    profile: "drone",
    isLocal: false,
    ...over,
  } as FleetNodeEntry;
}

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  useAgentConnectionStore.setState({ connectionError: null });
});

describe("selectNode — a relayed node reaches its agent through its ground station", () => {
  it("connects through the relay-proxy when the ground station is LAN-paired", async () => {
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: "gs-1",
          hostname: "http://192.168.1.50:8080",
          apiKey: "gs-key",
          name: "Ground One",
          pairedAt: 1,
          profile: "ground-station",
        },
      ] as never,
    });
    const connect = vi
      .spyOn(useAgentConnectionStore.getState(), "connect")
      .mockResolvedValue(undefined);
    const connectCloud = vi
      .spyOn(useAgentConnectionStore.getState(), "connectCloud")
      .mockImplementation(() => {});
    const disconnect = vi
      .spyOn(useAgentConnectionStore.getState(), "disconnect")
      .mockImplementation(() => {});
    const select = vi.spyOn(usePairingStore.getState(), "selectPairedDrone");
    const onError = vi.fn();

    await selectNode(node({ isRelayed: true, reachedVia: "node:gs-1" }), {
      onFocusAgent: () => {},
      onError,
    });

    expect(connectCloud).not.toHaveBeenCalled();
    expect(connect).toHaveBeenCalledWith(
      `http://192.168.1.50:8080/api/v1/ground-station/relay-proxy/${DEV}`,
      "gs-key",
      DEV,
      { relay: true },
    );
    expect(select).toHaveBeenCalledWith(`node:${DEV}`);
    expect(disconnect).toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("refuses when the relaying ground station is not paired on this browser", async () => {
    // No local node for `gs-1`: there is no relay-proxy host to dial, and a
    // cloud subscription would wait on a row that never appears.
    const connect = vi
      .spyOn(useAgentConnectionStore.getState(), "connect")
      .mockResolvedValue(undefined);
    const connectCloud = vi
      .spyOn(useAgentConnectionStore.getState(), "connectCloud")
      .mockImplementation(() => {});
    const disconnect = vi
      .spyOn(useAgentConnectionStore.getState(), "disconnect")
      .mockImplementation(() => {});
    const select = vi.spyOn(usePairingStore.getState(), "selectPairedDrone");
    const onError = vi.fn();

    await selectNode(node({ isRelayed: true, reachedVia: "node:gs-1" }), {
      onFocusAgent: () => {},
      onError,
    });

    expect(connect).not.toHaveBeenCalled();
    expect(connectCloud).not.toHaveBeenCalled();
    // The row is still selected and the previous node's connection is still
    // torn down: the operator can look at the funneled feed.
    expect(select).toHaveBeenCalledWith(`node:${DEV}`);
    expect(disconnect).toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("relay_only");
    expect(useAgentConnectionStore.getState().connectionError).toMatch(
      /radio relay/i,
    );
    // The copy must name the real cause — pairing the GROUND STATION — not
    // the old, now-false "pair this drone directly" instruction.
    expect(useAgentConnectionStore.getState().connectionError).toMatch(
      /ground station/i,
    );

    vi.restoreAllMocks();
  });

  it("connects a cloud-paired node over the relay as before", async () => {
    const connectCloud = vi
      .spyOn(useAgentConnectionStore.getState(), "connectCloud")
      .mockImplementation(() => {});
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(
      () => {},
    );
    const onError = vi.fn();

    await selectNode(node({ convexId: "row1" }), {
      onFocusAgent: () => {},
      onError,
    });

    expect(connectCloud).toHaveBeenCalledWith(DEV);
    expect(onError).not.toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it("connects a node that is relay-visible but also paired directly", async () => {
    // The relay hop rides along as provenance. The direct pairing is the reach,
    // so the resolver does not report relay-only and the connection opens.
    const connectCloud = vi
      .spyOn(useAgentConnectionStore.getState(), "connectCloud")
      .mockImplementation(() => {});
    vi.spyOn(useAgentConnectionStore.getState(), "disconnect").mockImplementation(
      () => {},
    );

    await selectNode(
      node({ convexId: "row1", reachedVia: "node:gs-1", isRelayed: false }),
      { onFocusAgent: () => {} },
    );

    expect(connectCloud).toHaveBeenCalledWith(DEV);

    vi.restoreAllMocks();
  });
});
