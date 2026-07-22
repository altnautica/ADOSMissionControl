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

    const { result } = renderHook(() => useNodeConfig());

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

    const { result } = renderHook(() => useNodeConfig());
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

    const { result } = renderHook(() => useNodeConfig());

    expect(result.current.readOnly).toBe(true);
    expect(result.current.accessMode).toBe("none");
    expect(result.current.config).toBeNull();
    await expect(
      result.current.setValue("logging.level", "debug"),
    ).rejects.toThrow(/no connection path/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
