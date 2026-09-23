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

const DRONE = "0a1b2c3d4e5f";

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
    const { result } = renderHook(() => useNodeConfig(DRONE, REACH));

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
    const { result } = renderHook(() => useNodeConfig(DRONE, REACH));
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
    const { result } = renderHook(() => useNodeConfig(DRONE));

    await waitFor(() => expect(result.current.accessMode).toBe("none"));
    expect(result.current.readOnly).toBe(true);
    expect(result.current.config).toBeNull();
  });

  it("does not re-fetch in a loop when the caller passes a fresh reach object every render", async () => {
    // `resolveRelayReach` mints a new object per call, so the call site's value
    // is identity-unstable. Depending on the object would make `refresh` new
    // every render and spin the effect forever.
    const { result, rerender } = renderHook(() =>
      useNodeConfig(DRONE, { ...REACH }),
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
          name: "testnode",
          hostname: "http://192.168.1.77:8080",
          apiKey: "own-key",
          profile: "drone",
          pairedAt: 1_700_000_000_000,
        },
      ],
    });

    const { result } = renderHook(() => useNodeConfig(DRONE, REACH));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    expect(result.current.accessMode).toBe("proxy");
    expect(calls[0]).not.toHaveProperty("peerDeviceId");
    expect(calls[0]).toMatchObject({ host: "http://192.168.1.77:8080" });
  });
});

describe("useNodeConfig across node switches and store churn", () => {
  const DRONE_B = "0f1e2d3c4b5a";
  const REACH_B: RelayReach = { ...REACH, peerDeviceId: DRONE_B };

  /** A fetch whose relay GETs stay open until the test answers them, per
   * target node, so reads can be resolved out of order. */
  function deferredFetch() {
    const pending = new Map<string, (body: object) => void>();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init: RequestInit) => {
        const req = JSON.parse(String(init.body)) as { peerDeviceId: string };
        calls.push(req);
        const { promise, resolve } = Promise.withResolvers<Response>();
        pending.set(req.peerDeviceId, (body) =>
          resolve(new Response(JSON.stringify(body), { status: 200 })),
        );
        return promise;
      }),
    );
    return (peer: string, body: object) => pending.get(peer)!(body);
  }

  it("keeps the newest node's document when the previous node answers last", async () => {
    const answer = deferredFetch();
    const { result, rerender } = renderHook(
      ({ id, reach }: { id: string; reach: RelayReach }) =>
        useNodeConfig(id, reach),
      { initialProps: { id: DRONE, reach: REACH } },
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    rerender({ id: DRONE_B, reach: REACH_B });
    await waitFor(() => expect(calls).toHaveLength(2));

    await act(async () => answer(DRONE_B, { node: "b" }));
    await act(async () => answer(DRONE, { node: "a" }));

    expect(result.current.config).toEqual({ node: "b" });
  });

  it("does not re-read the config when the pairing arrays are replaced", async () => {
    const { result } = renderHook(() => useNodeConfig(DRONE, REACH));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    const afterLoad = calls.length;

    // A presence stamp or a cloud-sync update replaces the arrays without
    // changing which transport reaches this node.
    act(() => {
      usePairingStore.setState({ pairedDrones: [] });
      useLocalNodesStore.setState({ nodes: [] });
    });
    const settled = Promise.withResolvers<void>();
    setTimeout(settled.resolve, 20);
    await settled.promise;

    expect(calls.length).toBe(afterLoad);
  });

  it("keeps the last good document when a later read fails, and reports the error", async () => {
    const { result } = renderHook(() => useNodeConfig(DRONE, REACH));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    const loaded = result.current.config;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).not.toBeNull();
    expect(result.current.config).toEqual(loaded);
  });
});
