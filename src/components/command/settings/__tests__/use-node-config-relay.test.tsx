/**
 * `useNodeConfig` on the relay lane.
 *
 * The bug this closes: a drone reached only through its ground station's WFB
 * relay had no direct client and no LAN pairing record of its own, so the hook
 * resolved `none` and every one of the settings pages the Agent page OFFERS for
 * that drone reported "Could not read the node configuration".
 *
 * @license GPL-3.0-only
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// Persisted local-nodes / pairing stores: bind an in-memory localStorage
// before import, the same way `select-node-relay.test.ts` does.
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

import { act, renderHook, waitFor } from "@testing-library/react";
import { useNodeConfig } from "../use-node-config";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";
import type { RelayReach } from "@/lib/nodes/relay-reach";

const DRONE = "77735cd38937";

const REACH: RelayReach = {
  baseUrl: "http://192.168.1.50:8080",
  apiKey: "gs-key",
  peerDeviceId: DRONE,
};

let calls: Record<string, unknown>[] = [];

beforeEach(() => {
  calls = [];
  vi.unstubAllGlobals();
  // The relayed drone's own state: no direct client (an HTTPS origin cannot
  // dial the station's plain-HTTP relay-proxy), no pairing record of its own.
  useAgentConnectionStore.setState({ client: null, nodeDeviceId: DRONE });
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve(
        new Response('{"swarm":{"enabled":false},"video":{"wfb":{}}}', {
          status: 200,
        }),
      );
    }),
  );
});

describe("useNodeConfig with a relay reach", () => {
  it("reports the relay lane and stays writable", async () => {
    const { result } = renderHook(() => useNodeConfig(REACH));

    await waitFor(() => expect(result.current.config).not.toBeNull());

    // Both halves matter: read-only would grey every control out, and an
    // accessMode of "direct" would tell the operator they are on a direct LAN
    // connection to a drone that has no IP address.
    expect(result.current.readOnly).toBe(false);
    expect(result.current.accessMode).toBe("relay");
    expect(result.current.error).toBeNull();
    expect(result.current.config).toEqual({
      swarm: { enabled: false },
      video: { wfb: {} },
    });
    expect(calls[0]).toMatchObject({
      host: REACH.baseUrl,
      apiKey: REACH.apiKey,
      method: "GET",
      peerDeviceId: DRONE,
    });
  });

  it("writes through the relay and re-reads to confirm the round-trip", async () => {
    const { result } = renderHook(() => useNodeConfig(REACH));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    calls = [];

    await act(async () => {
      await result.current.setValue("swarm.enabled", "true");
    });

    expect(calls[0]).toMatchObject({
      method: "PUT",
      peerDeviceId: DRONE,
      body: { key: "swarm.enabled", value: "true" },
    });
    // The read-back is what makes the field show the persisted value.
    expect(calls[1]).toMatchObject({ method: "GET", peerDeviceId: DRONE });
  });

  it("is read-only with no reach, which is the bug being fixed", async () => {
    const { result } = renderHook(() => useNodeConfig());

    await waitFor(() => expect(result.current.accessMode).toBe("none"));
    expect(result.current.readOnly).toBe(true);
    expect(result.current.config).toBeNull();
  });

  it("does not re-fetch in a loop when the caller passes a fresh reach object every render", async () => {
    // `resolveRelayReach` mints a new object per call, so the call site's value
    // is identity-unstable. Depending on the object would make `refresh` new
    // every render and spin the effect forever.
    const { result, rerender } = renderHook(() =>
      useNodeConfig({ ...REACH }),
    );
    await waitFor(() => expect(result.current.config).not.toBeNull());
    const afterFirstLoad = calls.length;

    rerender();
    rerender();
    rerender();
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 20);
    await settled.promise;

    expect(calls.length).toBe(afterFirstLoad);
  });

  it("prefers the drone's own pairing record over the relay when it has one", async () => {
    useLocalNodesStore.setState({
      nodes: [
        {
          deviceId: DRONE,
          name: "skynode",
          hostname: "http://192.168.1.77:8080",
          apiKey: "own-key",
          profile: "drone",
          pairedAt: 1_700_000_000_000,
        },
      ],
    });

    const { result } = renderHook(() => useNodeConfig(REACH));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    expect(result.current.accessMode).toBe("proxy");
    expect(calls[0]).not.toHaveProperty("peerDeviceId");
    expect(calls[0]).toMatchObject({ host: "http://192.168.1.77:8080" });
  });
});
