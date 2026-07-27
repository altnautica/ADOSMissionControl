/**
 * @module nodes/relay-reach.test
 * @description The relay reach resolver decides whether a drone reached only
 * over another node's radio has an HTTP lane at all, and what URL it is. The
 * bug this replaces read `FleetNodeEntry.mdnsHost ?? lastIp`, which
 * `adaptLocal()` never populates for a LAN-only ground station — so a ground
 * station the GCS was actively talking to resolved to no reach.
 * @license GPL-3.0-only
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

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

import { relayProxyBaseUrl, resolveRelayReach } from "../relay-reach";
import { useLocalNodesStore } from "@/stores/local-nodes-store";

const GS = {
  deviceId: "gs-1",
  hostname: "http://192.168.200.200:8080",
  apiKey: "gs-key",
  name: "Ground One",
  pairedAt: 1,
  profile: "ground-station",
};

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
});

describe("resolveRelayReach", () => {
  it("resolves a LAN-paired ground station with no mDNS host", () => {
    // The whole point: `hostname` is the paired reach, and it is enough.
    useLocalNodesStore.setState({ nodes: [GS] as never });
    const reach = resolveRelayReach({
      agentDeviceId: null,
      reachedVia: "node:gs-1",
      droneDeviceId: "77735cd38937",
    });
    expect(reach).toEqual({
      baseUrl: "http://192.168.200.200:8080",
      apiKey: "gs-key",
      peerDeviceId: "77735cd38937",
    });
  });

  it("strips the node: prefix off a canonical drone id", () => {
    useLocalNodesStore.setState({ nodes: [GS] as never });
    const reach = resolveRelayReach({
      agentDeviceId: null,
      reachedVia: "node:gs-1",
      droneDeviceId: "node:77735cd38937",
    });
    expect(reach?.peerDeviceId).toBe("77735cd38937");
  });

  it("returns null for a node with direct reach", () => {
    // Routing a directly-reachable node's own API through a third node would
    // spend radio airtime for nothing.
    useLocalNodesStore.setState({ nodes: [GS] as never });
    expect(
      resolveRelayReach({
        agentDeviceId: "77735cd38937",
        reachedVia: "node:gs-1",
        droneDeviceId: "77735cd38937",
      }),
    ).toBeNull();
  });

  it("returns null when the ground station is not paired on this browser", () => {
    expect(
      resolveRelayReach({
        agentDeviceId: null,
        reachedVia: "node:gs-1",
        droneDeviceId: "77735cd38937",
      }),
    ).toBeNull();
  });

  it("returns null when the ground station has no API key", () => {
    useLocalNodesStore.setState({ nodes: [{ ...GS, apiKey: "" }] as never });
    expect(
      resolveRelayReach({
        agentDeviceId: null,
        reachedVia: "node:gs-1",
        droneDeviceId: "77735cd38937",
      }),
    ).toBeNull();
  });

  it("returns null with no reach hop, and for a non-node hop id", () => {
    useLocalNodesStore.setState({ nodes: [GS] as never });
    for (const reachedVia of [undefined, null, "", "fc:abc123"]) {
      expect(
        resolveRelayReach({
          agentDeviceId: null,
          reachedVia,
          droneDeviceId: "77735cd38937",
        }),
      ).toBeNull();
    }
  });
});

describe("relayProxyBaseUrl", () => {
  it("composes the ground station's relay-proxy prefix for the peer", () => {
    // This string is what an AgentClient is constructed against, and the Rust
    // wildcard re-prefixes the tail verbatim, so `${base}/api/status` must
    // reach the drone's own `/api/status`.
    expect(
      relayProxyBaseUrl({
        baseUrl: "http://192.168.200.200:8080",
        apiKey: "k",
        peerDeviceId: "77735cd38937",
      }),
    ).toBe(
      "http://192.168.200.200:8080/api/v1/ground-station/relay-proxy/77735cd38937",
    );
  });
});
