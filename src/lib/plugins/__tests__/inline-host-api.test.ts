/**
 * `host.nodes.agent(deviceId)`: an inline module reaches its own plugin
 * server on another node through that node's LAN address, or its ground
 * station's relay-proxy when the drone has no address, and gets a typed
 * `node_unreachable` for a node this browser cannot reach.
 *
 * @license GPL-3.0-only
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


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
import { useLocalNodesStore, type LocalNode } from "@/stores/local-nodes-store";
import { useNodeRegistryStore } from "@/stores/node-registry";
import { createInlineChannel, createInlineContext } from "../inline-context";
import { createInlineHostSession } from "../inline-host-api";
import { InlineHostError } from "../inline-host-types";
import type { InlineBundle } from "../inline-loader";

const PLUGIN_ID = "com.example.inline";

function paired(deviceId: string, hostname: string, apiKey: string): LocalNode {
  return { deviceId, name: deviceId, hostname, apiKey, profile: "drone", pairedAt: 0 };
}

function session() {
  const bundle: InlineBundle = {
    kind: "inline",
    module: { mount: () => () => {} },
    trust: { pluginId: PLUGIN_ID, version: "1.0.0", signerId: "s", entrypoint: "gcs/m.mjs", paths: [] },
    readAsset: (path) =>
      path === "assets/viewer.wasm"
        ? Promise.resolve(new Blob([new Uint8Array([0, 97, 115, 109])]))
        : Promise.reject(new Error("no such asset")),
  };
  return createInlineHostSession({
    pluginId: PLUGIN_ID,
    panelId: "p",
    bundle,
    deviceId: "ws-1",
    nodeProfile: "workstation",
    ctx: createInlineContext(createInlineChannel(() => {}).client),
  });
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  useLocalNodesStore.setState({
    nodes: [
      paired("drone-lan", "http://192.168.1.20:8080", "key-lan"),
      paired("gs-1", "http://192.168.1.50:8080", "key-gs"),
    ],
  });
  useNodeRegistryStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  useLocalNodesStore.setState({ nodes: [] });
  useNodeRegistryStore.getState().clear();
});

function lastCall(): { url: string; key: string | null } {
  const [input, init] = fetchMock.mock.calls[fetchMock.mock.calls.length - 1];
  return { url: String(input), key: new Headers(init?.headers).get("X-ADOS-Key") };
}

describe("host.nodes.agent", () => {
  it("reaches the plugin server on a LAN-paired node with that node's key", async () => {
    await session().api.nodes.agent("drone-lan").fetch("offload/status?full=1");
    expect(lastCall()).toEqual({
      url: `http://192.168.1.20:8080/api/plugins/${PLUGIN_ID}/x/offload/status?full=1`,
      key: "key-lan",
    });
  });

  it("reaches a relay-only drone through its ground station's relay-proxy", async () => {
    useNodeRegistryStore
      .getState()
      .upsertPresence("node:drone-r", { deviceId: "drone-r", reachedVia: "node:gs-1" }, "relayed");
    await session().api.nodes.agent("drone-r").fetch("atlas/state", { method: "POST" });
    expect(lastCall()).toEqual({
      url: `http://192.168.1.50:8080/api/v1/ground-station/relay-proxy/drone-r/api/plugins/${PLUGIN_ID}/x/atlas/state`,
      key: "key-gs",
    });
  });

  it("rejects both calls with node_unreachable for a node this browser cannot reach", async () => {
    const agent = session().api.nodes.agent("nobody");
    for (const pending of [agent.fetch("status"), agent.websocket("ws")]) {
      const err = await pending.then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(InlineHostError);
      expect((err as InlineHostError).code).toBe("node_unreachable");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("host.readAsset", () => {
  it("serves a gcs/ file's bytes typed by extension, and refuses after unmount", async () => {
    const s = session();
    const blob = await s.api.readAsset("/assets/viewer.wasm");
    expect(blob.type).toBe("application/wasm");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(new Uint8Array([0, 97, 115, 109]));

    s.release();
    const err = await s.api.readAsset("assets/viewer.wasm").then(() => null, (e: unknown) => e);
    expect((err as InlineHostError).code).toBe("asset_unavailable");
  });
});
