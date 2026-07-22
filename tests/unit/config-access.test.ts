/**
 * Tests for the shared config-access resolution: direct client wins, a
 * stored LAN pairing resolves the server-side proxy path (writable in
 * cloud mode), and only a node with genuinely no path resolves read-only
 * with the no-path reason. Also pins the proxy transport envelope
 * (`{host, apiKey, method, body}` to `/api/lan-pair/config`) and its
 * error mapping.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  getConfigViaAccess,
  hasClientPath,
  resolveConfigAccess,
  resolveConfigProxyTarget,
  setConfigValueViaAccess,
  type AgentConfigClient,
} from "@/lib/agent/config-access";
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { usePairingStore, type PairedDrone } from "@/stores/pairing-store";

function localNode(
  overrides: Partial<LocalNode> & { deviceId: string },
): LocalNode {
  return {
    name: overrides.deviceId,
    hostname: "http://dev.local:8080",
    apiKey: "LOCAL-KEY",
    profile: "drone",
    pairedAt: 0,
    ...overrides,
  };
}

function pairedDrone(
  overrides: Partial<PairedDrone> & { deviceId: string },
): PairedDrone {
  return {
    _id: "row-1",
    userId: "user-1",
    name: overrides.deviceId,
    apiKey: "CLOUD-KEY",
    pairedAt: 0,
    ...overrides,
  };
}

const stubClient: AgentConfigClient = {
  getConfig: async () => ({}),
  setConfigValue: async () => ({}),
};

beforeEach(() => {
  useLocalNodesStore.setState({ nodes: [] });
  usePairingStore.setState({ pairedDrones: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("resolveConfigAccess", () => {
  it("resolves direct when a client is attached", () => {
    const access = resolveConfigAccess(stubClient, "dev-1");
    expect(access).toEqual({ mode: "direct", client: stubClient });
  });

  it("resolves the proxy path from a browser-local pairing record", () => {
    useLocalNodesStore.setState({ nodes: [localNode({ deviceId: "dev-1" })] });
    const access = resolveConfigAccess(null, "dev-1");
    expect(access).toEqual({
      mode: "proxy",
      target: { host: "http://dev.local:8080", apiKey: "LOCAL-KEY" },
    });
  });

  it("falls back to the cloud pairing record for the proxy target", () => {
    usePairingStore.setState({
      pairedDrones: [
        pairedDrone({ deviceId: "dev-2", mdnsHost: "skynode.local" }),
      ],
    });
    const access = resolveConfigAccess(null, "dev-2");
    expect(access).toEqual({
      mode: "proxy",
      target: { host: "skynode.local", apiKey: "CLOUD-KEY" },
    });
  });

  it("resolves none with the no-path reason when nothing reaches the node", () => {
    const access = resolveConfigAccess(null, "dev-unknown");
    expect(access).toEqual({ mode: "none", reason: "no-path" });
  });

  it("resolves none for a record that stores no host", () => {
    usePairingStore.setState({
      pairedDrones: [pairedDrone({ deviceId: "dev-3" })],
    });
    expect(resolveConfigAccess(null, "dev-3").mode).toBe("none");
  });

  it("resolves none when the focused node has no device id", () => {
    useLocalNodesStore.setState({ nodes: [localNode({ deviceId: "dev-1" })] });
    expect(resolveConfigAccess(null, null).mode).toBe("none");
  });
});

describe("resolveConfigProxyTarget", () => {
  it("prefers the browser-local record over the cloud record", () => {
    useLocalNodesStore.setState({ nodes: [localNode({ deviceId: "dev-1" })] });
    usePairingStore.setState({
      pairedDrones: [
        pairedDrone({ deviceId: "dev-1", mdnsHost: "other.local" }),
      ],
    });
    expect(resolveConfigProxyTarget("dev-1")).toEqual({
      host: "http://dev.local:8080",
      apiKey: "LOCAL-KEY",
    });
  });
});

describe("hasClientPath", () => {
  it("is true exactly when a client object exists", () => {
    expect(hasClientPath(stubClient)).toBe(true);
    expect(hasClientPath(null)).toBe(false);
    expect(hasClientPath(undefined)).toBe(false);
  });
});

describe("proxy transport", () => {
  it("writes through the proxy with the pinned envelope and returns the body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ status: "ok", key: "logging.level", value: "debug" }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await setConfigValueViaAccess(
      { mode: "proxy", target: { host: "http://dev.local:8080", apiKey: "K" } },
      "logging.level",
      "debug",
    );
    expect(res).toEqual({ status: "ok", key: "logging.level", value: "debug" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/lan-pair/config");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      host: "http://dev.local:8080",
      apiKey: "K",
      method: "PUT",
      body: { key: "logging.level", value: "debug" },
    });
  });

  it("reads the config through the proxy with a GET envelope", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ logging: { level: "info" } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const cfg = await getConfigViaAccess({
      mode: "proxy",
      target: { host: "dev.local", apiKey: null },
    });
    expect(cfg).toEqual({ logging: { level: "info" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ host: "dev.local", method: "GET" });
  });

  it("surfaces the proxy's upstream-unreachable message as a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "upstream_unreachable",
              message: "connect ECONNREFUSED",
            }),
            { status: 502 },
          ),
      ),
    );
    await expect(
      getConfigViaAccess({
        mode: "proxy",
        target: { host: "dev.local", apiKey: null },
      }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it("rejects both operations when no path exists", async () => {
    const none = { mode: "none", reason: "no-path" } as const;
    await expect(getConfigViaAccess(none)).rejects.toThrow(
      /no connection path/i,
    );
    await expect(
      setConfigValueViaAccess(none, "logging.level", "debug"),
    ).rejects.toThrow(/no connection path/i);
  });
});
