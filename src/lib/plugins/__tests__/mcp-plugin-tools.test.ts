import { describe, it, expect, vi, afterEach } from "vitest";

const localNodes = vi.hoisted(() => ({ nodes: [] as Array<{ deviceId: string; hostname: string; apiKey: string }> }));
vi.mock("@/stores/local-nodes-store", () => ({
  useLocalNodesStore: { getState: () => localNodes },
}));

import {
  countExposedPlugins,
  filterPlugins,
  useMcpPluginStore,
  type McpPluginView,
} from "../mcp-plugin-tools";

afterEach(() => {
  vi.unstubAllGlobals();
  localNodes.nodes = [];
  useMcpPluginStore.setState({ plugins: [], status: "idle" });
});

const view = (over: Partial<McpPluginView> & { pluginId: string; name: string }): McpPluginView => ({
  version: "1.0.0",
  firstParty: false,
  mcpExposed: true,
  grantedCaps: [],
  installedOn: [],
  tools: [],
  resources: [],
  prompts: [],
  ...over,
});

describe("countExposedPlugins", () => {
  it("counts only plugins that expose MCP", () => {
    const plugins = [
      view({ pluginId: "a", name: "A", mcpExposed: true }),
      view({ pluginId: "b", name: "B", mcpExposed: false }),
      view({ pluginId: "c", name: "C", mcpExposed: true }),
    ];
    expect(countExposedPlugins(plugins)).toBe(2);
  });
});

describe("filterPlugins", () => {
  const plugins = [
    view({ pluginId: "com.x.follow", name: "Follow-Me" }),
    view({ pluginId: "com.x.orbit", name: "Orbit" }),
  ];
  it("matches by name or id, case-insensitive; empty query returns all", () => {
    expect(filterPlugins(plugins, "").map((p) => p.name)).toEqual(["Follow-Me", "Orbit"]);
    expect(filterPlugins(plugins, "orb").map((p) => p.name)).toEqual(["Orbit"]);
    expect(filterPlugins(plugins, "FOLLOW").map((p) => p.name)).toEqual(["Follow-Me"]);
    expect(filterPlugins(plugins, "com.x.orbit").map((p) => p.name)).toEqual(["Orbit"]);
    expect(filterPlugins(plugins, "zzz")).toEqual([]);
  });
});

describe("plugin discovery from the fleet", () => {
  // The agent's GET /api/plugins and GET /api/plugins/{id} bodies
  // (ADOSDroneAgent src/ados/api/routes/plugins.py list_plugins / get_plugin).
  function detail(id: string, opts: { tools: unknown[]; granted: string[]; signer: string | null }) {
    return {
      install: {
        plugin_id: id, version: "1.2.0", source: "registry", source_uri: null, signer_id: opts.signer,
        manifest_hash: "h", status: "enabled", installed_at: 1, enabled_at: 2, permissions: {},
      },
      granted_capabilities: opts.granted,
      manifest: {
        id, version: "1.2.0", name: id, risk: "low", license: "MIT", halves: ["agent"], gcs: null, permissions: [],
        mcp: { tools: opts.tools, resources: [], prompts: [] },
      },
    };
  }

  it("lists a node's plugins that declare MCP tools, with their exposure and trust", async () => {
    localNodes.nodes = [{ deviceId: "drone-1", hostname: "http://192.168.1.50:8080", apiKey: "k" }];
    const bodies: Record<string, unknown> = {
      "/api/plugins": { installs: [{ plugin_id: "com.example.survey" }, { plugin_id: "com.example.quiet" }] },
      "/api/plugins/com.example.survey": detail("com.example.survey", {
        tools: [{ name: "plan_grid", safety_class: "read", half: "agent" }],
        granted: ["mcp.expose"],
        signer: "altnautica-2026-A",
      }),
      "/api/plugins/com.example.quiet": detail("com.example.quiet", { tools: [], granted: [], signer: null }),
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      return new Response(JSON.stringify(bodies[path] ?? {}), { status: path in bodies ? 200 : 404 });
    }));

    await useMcpPluginStore.getState().load();

    const { plugins, status } = useMcpPluginStore.getState();
    expect(status).toBe("ready");
    expect(plugins).toHaveLength(1);
    expect(plugins[0]).toMatchObject({
      pluginId: "com.example.survey",
      mcpExposed: true,
      firstParty: true,
      installedOn: ["drone-1"],
      tools: [{ name: "plan_grid", safetyClass: "read", half: "agent" }],
    });
  });

  it("reports discovery unavailable, not an empty fleet, when no node answers", async () => {
    localNodes.nodes = [{ deviceId: "drone-1", hostname: "http://192.168.1.50:8080", apiKey: "k" }];
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }));
    await useMcpPluginStore.getState().load();
    expect(useMcpPluginStore.getState().status).toBe("unavailable");
  });
});
