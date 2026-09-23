/**
 * Tests for `useNodeConfig` transport resolution: a cloud-mode session
 * (client detached) with a stored LAN pairing is WRITABLE — the write
 * rides the `/api/lan-pair/config` proxy and keeps the read-back-confirm
 * loop — while a node with genuinely no path resolves read-only with the
 * no-path reason and a rejecting writer.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// happy-dom's localStorage.setItem is not a function in this config, so the
// persist middleware in local-nodes-store (whose storage is captured at import)
// would throw on setState. Install a working in-memory localStorage BEFORE the
// store modules load (vi.hoisted runs before imports).
vi.hoisted(() => {
  const map = new Map<string, string>();
  const storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k);
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v));
    },
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }
});

import {
  readConfigPath,
  useNodeConfig,
} from "@/components/command/settings/use-node-config";
import { useAgentConnectionStore } from "@/stores/agent-connection-store";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore } from "@/stores/pairing-store";

function node(overrides: Partial<LocalNode> & { deviceId: string }): LocalNode {
  return {
    name: overrides.deviceId,
    hostname: "http://dev.local:8080",
    apiKey: "KEY",
    profile: "drone",
    pairedAt: 0,
    ...overrides,
  };
}

const initialConnectionState = useAgentConnectionStore.getState();

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
});

afterEach(() => {
  useAgentConnectionStore.setState(initialConnectionState, true);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useNodeConfig in cloud mode with a stored LAN pairing", () => {
  it("is writable and round-trips a write through the proxy with read-back", async () => {
    // Cloud mode always detaches the direct client; the stored pairing
    // record is what resolves the proxy path.
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: "dev-1",
    });
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev-1" })] });

    // A tiny agent-config fake behind the proxy endpoint: GET serves the
    // current config, PUT persists the key so the read-back confirms the
    // real stored value rather than an optimistic echo.
    let level = "info";
    const envelopes: Array<{ method: string; body?: unknown }> = [];
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(url).toBe("/api/lan-pair/config");
      const envelope = JSON.parse((init?.body as string) ?? "{}") as {
        host: string;
        apiKey?: string;
        method: string;
        body?: { key?: string; value?: string };
      };
      envelopes.push({ method: envelope.method, body: envelope.body });
      expect(envelope.host).toBe("http://dev.local:8080");
      expect(envelope.apiKey).toBe("KEY");
      if (envelope.method === "GET") {
        return new Response(JSON.stringify({ logging: { level } }), {
          status: 200,
        });
      }
      if (envelope.method === "PUT") {
        level = envelope.body?.value ?? level;
        return new Response(
          JSON.stringify({ status: "ok", key: envelope.body?.key, value: level }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ error: "bad_method" }), {
        status: 400,
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNodeConfig("dev-1"));

    await waitFor(() => {
      expect(result.current.config).not.toBeNull();
    });
    expect(result.current.accessMode).toBe("proxy");
    expect(result.current.readOnly).toBe(false);
    expect(readConfigPath(result.current.config, "logging.level")).toBe("info");

    await act(async () => {
      await result.current.setValue("logging.level", "debug");
    });

    // Write went through the proxy, then the read-back confirmed the
    // persisted value (initial GET, PUT, read-back GET).
    expect(envelopes.map((e) => e.method)).toEqual(["GET", "PUT", "GET"]);
    expect(envelopes[1].body).toEqual({ key: "logging.level", value: "debug" });
    expect(readConfigPath(result.current.config, "logging.level")).toBe(
      "debug",
    );
  });

  it("surfaces the agent's rejection from behind the proxy", async () => {
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: "dev-1",
    });
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev-1" })] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const envelope = JSON.parse((init?.body as string) ?? "{}") as {
          method: string;
        };
        if (envelope.method === "GET") {
          return new Response(JSON.stringify({}), { status: 200 });
        }
        return new Response(JSON.stringify({ error: "unknown config key" }), {
          status: 200,
        });
      }),
    );

    const { result } = renderHook(() => useNodeConfig("dev-1"));
    await waitFor(() => expect(result.current.readOnly).toBe(false));
    await expect(
      result.current.setValue("nope.key", "1"),
    ).rejects.toThrow("unknown config key");
  });
});

describe("useNodeConfig with no path to the node", () => {
  it("resolves read-only with the no-path reason and a rejecting writer", async () => {
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: "dev-unpaired",
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNodeConfig("dev-unpaired"));

    expect(result.current.readOnly).toBe(true);
    expect(result.current.accessMode).toBe("none");
    expect(result.current.config).toBeNull();
    await expect(
      result.current.setValue("logging.level", "debug"),
    ).rejects.toThrow(/no connection path/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("useNodeConfig honours the agent's persisted flag", () => {
  /** The exact shape `PUT /api/config` returns when it took the value into the
   * running model but could not write `/etc/ados/config.yaml`: HTTP 200,
   * `status: "ok"`, the new value echoed back, `persisted: false`. */
  function wireRamOnlyAgent(persistError?: string) {
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: "dev-1",
    });
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev-1" })] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const envelope = JSON.parse((init?.body as string) ?? "{}") as {
          method: string;
        };
        if (envelope.method === "GET") {
          return new Response(JSON.stringify({ logging: { level: "info" } }), {
            status: 200,
          });
        }
        return new Response(
          JSON.stringify({
            status: "ok",
            key: "logging.level",
            value: "debug",
            persisted: false,
            ...(persistError ? { persist_error: persistError } : {}),
          }),
          { status: 200 },
        );
      }),
    );
  }

  it("rejects a write the node could not put on disk, naming the consequence and the action", async () => {
    wireRamOnlyAgent("[Errno 30] Read-only file system: '/etc/ados/config.yaml'");
    const { result } = renderHook(() => useNodeConfig("dev-1"));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    // A resolved promise here is what every field primitive turns into the
    // green "Saved" toast, so the write MUST reject.
    const write = result.current.setValue("logging.level", "debug");
    await expect(write).rejects.toThrow(/lost when the node restarts/i);
    await expect(
      result.current.setValue("logging.level", "debug"),
    ).rejects.toThrow(/Read-only file system/);
  });

  it("still rejects when the agent reports no reason (a non-root agent)", async () => {
    wireRamOnlyAgent();
    const { result } = renderHook(() => useNodeConfig("dev-1"));
    await waitFor(() => expect(result.current.config).not.toBeNull());

    await expect(
      result.current.setValue("logging.level", "debug"),
    ).rejects.toThrow(/could not write it to disk/i);
  });

  it("accepts a write the node persisted", async () => {
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: "dev-1",
    });
    useLocalNodesStore.setState({ nodes: [node({ deviceId: "dev-1" })] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            status: "ok",
            key: "logging.level",
            value: "debug",
            persisted: true,
            logging: { level: "debug" },
          }),
          { status: 200 },
        ),
      ),
    );

    const { result } = renderHook(() => useNodeConfig("dev-1"));
    await waitFor(() => expect(result.current.config).not.toBeNull());
    await expect(
      result.current.setValue("logging.level", "debug"),
    ).resolves.toBeUndefined();
  });
});

describe("useNodeConfig transport belongs to the rendered node", () => {
  it("never writes through a client attached to a different node", async () => {
    // The defect: the store holds node A's client while the page renders node
    // B. Resolving the ambient client would send B's write to A.
    const writes: Array<[string, string]> = [];
    const nodeAClient = {
      getConfig: async () => ({ logging: { level: "info" } }),
      setConfigValue: async (key: string, value: string) => {
        writes.push([key, value]);
        return { status: "ok", key, value, persisted: true };
      },
    };
    useAgentConnectionStore.setState({
      client: nodeAClient as unknown as never,
      cloudMode: false,
      nodeDeviceId: "node-a",
    });
    // Node B has no pairing record of its own, so with the client correctly
    // refused there is genuinely no path.
    useLocalNodesStore.setState({ nodes: [] });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const { result } = renderHook(() => useNodeConfig("node-b"));

    expect(result.current.accessMode).toBe("none");
    expect(result.current.readOnly).toBe(true);
    await expect(
      result.current.setValue("logging.level", "debug"),
    ).rejects.toThrow(/no connection path/i);
    expect(writes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the direct client when it is attached to this very node", async () => {
    const writes: Array<[string, string]> = [];
    const client = {
      getConfig: async () => ({ logging: { level: "info" } }),
      setConfigValue: async (key: string, value: string) => {
        writes.push([key, value]);
        return { status: "ok", key, value, persisted: true };
      },
    };
    useAgentConnectionStore.setState({
      client: client as unknown as never,
      cloudMode: false,
      nodeDeviceId: "node-a",
    });

    const { result } = renderHook(() => useNodeConfig("node-a"));
    await waitFor(() => expect(result.current.accessMode).toBe("direct"));
    await act(async () => {
      await result.current.setValue("logging.level", "debug");
    });
    expect(writes).toEqual([["logging.level", "debug"]]);
  });

  it("drops the loaded document when the node identity changes", async () => {
    const client = {
      getConfig: async () => ({ logging: { level: "info" } }),
      setConfigValue: async () => ({ status: "ok", persisted: true }),
    };
    useAgentConnectionStore.setState({
      client: client as unknown as never,
      cloudMode: false,
      nodeDeviceId: "node-a",
    });
    useLocalNodesStore.setState({ nodes: [] });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useNodeConfig(id),
      { initialProps: { id: "node-a" } },
    );
    await waitFor(() => expect(result.current.config).not.toBeNull());

    // Switching to a node this browser cannot reach must blank the document
    // rather than render node A's values under node B.
    rerender({ id: "node-b" });
    expect(result.current.config).toBeNull();
    expect(result.current.accessMode).toBe("none");
  });

  it("discards node A's read when it resolves after node B's", async () => {
    // Both nodes are LAN-paired, so both resolve the proxy lane. Each GET is
    // held open until the test releases it, so A's answer can land last.
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: null,
    });
    useLocalNodesStore.setState({
      nodes: [
        node({ deviceId: "node-a", hostname: "http://node-a.local:8080" }),
        node({ deviceId: "node-b", hostname: "http://node-b.local:8080" }),
      ],
    });
    const pending = new Map<string, Array<() => void>>();
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        const { host } = JSON.parse((init?.body as string) ?? "{}") as {
          host: string;
        };
        const name = host.includes("node-a") ? "a" : "b";
        return new Promise<Response>((resolve) => {
          const queue = pending.get(name) ?? [];
          queue.push(() =>
            resolve(
              new Response(JSON.stringify({ owner: { name } }), {
                status: 200,
              }),
            ),
          );
          pending.set(name, queue);
        });
      }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useNodeConfig(id),
      { initialProps: { id: "node-a" } },
    );
    await waitFor(() => expect(pending.get("a")?.length).toBe(1));

    rerender({ id: "node-b" });
    await waitFor(() => expect(pending.get("b")?.length).toBe(1));

    await act(async () => {
      pending.get("b")![0]();
    });
    await waitFor(() =>
      expect(readConfigPath(result.current.config, "owner.name")).toBe("b"),
    );
    expect(result.current.loading).toBe(false);

    await act(async () => {
      pending.get("a")![0]();
    });
    expect(readConfigPath(result.current.config, "owner.name")).toBe("b");
    expect(result.current.loading).toBe(false);
  });

  it("keeps node B's read when node A's write read-back starts after it", async () => {
    useAgentConnectionStore.setState({
      client: null,
      cloudMode: true,
      nodeDeviceId: null,
    });
    useLocalNodesStore.setState({
      nodes: [
        node({ deviceId: "node-a", hostname: "http://node-a.local:8080" }),
        node({ deviceId: "node-b", hostname: "http://node-b.local:8080" }),
      ],
    });
    // Node A answers reads at once; its write and node B's read are held.
    const held: { write?: () => void; read?: () => void } = {};
    const getsByNode: Record<"a" | "b", number> = { a: 0, b: 0 };
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: unknown, init?: RequestInit) => {
        const { host, method } = JSON.parse(
          (init?.body as string) ?? "{}",
        ) as { host: string; method: string };
        const name = host.includes("node-a") ? "a" : "b";
        const body =
          method === "PUT"
            ? { status: "ok", persisted: true }
            : { owner: { name } };
        const reply = new Response(JSON.stringify(body), { status: 200 });
        if (method === "PUT") {
          return new Promise<Response>((resolve) => {
            held.write = () => resolve(reply);
          });
        }
        getsByNode[name] += 1;
        if (name === "b") {
          return new Promise<Response>((resolve) => {
            held.read = () => resolve(reply);
          });
        }
        return Promise.resolve(reply);
      }),
    );

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useNodeConfig(id),
      { initialProps: { id: "node-a" } },
    );
    await waitFor(() =>
      expect(readConfigPath(result.current.config, "owner.name")).toBe("a"),
    );

    let write: Promise<void> = Promise.resolve();
    act(() => {
      write = result.current.setValue("owner.name", "x");
    });
    rerender({ id: "node-b" });
    await waitFor(() => expect(held.read).toBeDefined());

    // A's write lands while B's read is still in flight: the read-back for A
    // must not run, and must not displace B's read.
    await act(async () => {
      held.write!();
      await write;
    });
    expect(getsByNode.a).toBe(1);
    await act(async () => {
      held.read!();
    });
    await waitFor(() =>
      expect(readConfigPath(result.current.config, "owner.name")).toBe("b"),
    );
  });
});
