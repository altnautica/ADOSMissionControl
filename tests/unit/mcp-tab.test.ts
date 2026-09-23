import { describe, it, expect, beforeEach } from "vitest";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import {
  SCOPE_PRESETS,
  SCOPE_PRESET_ORDER,
  connectRecipe,
  localConnectRecipe,
  localMcpJsonSnippet,
  localVerifyRecipe,
  localFleetConnectRecipe,
  localFleetVerifyRecipe,
  fleetFileContents,
  fleetEnvValue,
  localFleetEnvRecipe,
} from "@/components/mcp/mcp-shared";

function reset() {
  useMcpTabStore.setState({
    view: { kind: "overview" },
    expandedPlugins: [],
    pluginFilter: "",
    selectedCredentialId: null,
    generateOpen: false,
    revealed: null,
    revokeTokenId: null,
  });
}

describe("mcp-tab-store", () => {
  beforeEach(reset);

  it("navigates between sidebar views", () => {
    expect(useMcpTabStore.getState().view).toEqual({ kind: "overview" });
    useMcpTabStore.getState().navigate({ kind: "audit" });
    expect(useMcpTabStore.getState().view).toEqual({ kind: "audit" });
    useMcpTabStore.getState().navigate({ kind: "plugin", pluginId: "com.x.p" });
    expect(useMcpTabStore.getState().view).toEqual({ kind: "plugin", pluginId: "com.x.p" });
  });

  it("toggles expanded plugin nodes and tracks the plugin filter + selected credential", () => {
    useMcpTabStore.getState().togglePlugin("com.x.p");
    expect(useMcpTabStore.getState().expandedPlugins).toEqual(["com.x.p"]);
    useMcpTabStore.getState().togglePlugin("com.x.p");
    expect(useMcpTabStore.getState().expandedPlugins).toEqual([]);
    useMcpTabStore.getState().setPluginFilter("orb");
    expect(useMcpTabStore.getState().pluginFilter).toBe("orb");
    useMcpTabStore.getState().selectCredential("mct_1");
    expect(useMcpTabStore.getState().selectedCredentialId).toBe("mct_1");
  });

  it("opens and closes the generate dialog", () => {
    useMcpTabStore.getState().openGenerate();
    expect(useMcpTabStore.getState().generateOpen).toBe(true);
    useMcpTabStore.getState().closeGenerate();
    expect(useMcpTabStore.getState().generateOpen).toBe(false);
  });

  it("reveal closes the generate dialog and carries the payload once", () => {
    useMcpTabStore.getState().openGenerate();
    useMcpTabStore.getState().reveal({ credential: "ados_mc_abc", label: "laptop", tokenId: "t1" });
    const s = useMcpTabStore.getState();
    expect(s.generateOpen).toBe(false);
    expect(s.revealed).toEqual({ credential: "ados_mc_abc", label: "laptop", tokenId: "t1" });
    s.clearRevealed();
    expect(useMcpTabStore.getState().revealed).toBeNull();
  });

  it("tracks the pending revoke target", () => {
    useMcpTabStore.getState().askRevoke("t9");
    expect(useMcpTabStore.getState().revokeTokenId).toBe("t9");
    useMcpTabStore.getState().askRevoke(null);
    expect(useMcpTabStore.getState().revokeTokenId).toBeNull();
  });
});

describe("mcp scope presets", () => {
  it("read is the narrowest, full is the widest, operate sits between with no flight", () => {
    expect(SCOPE_PRESETS.read).toEqual(["read"]);
    expect(SCOPE_PRESETS.operate).not.toContain("flight");
    expect(SCOPE_PRESETS.operate).toContain("admin");
    expect(SCOPE_PRESETS.full).toContain("flight");
    // narrowing invariant: each preset's scope set is a superset of the previous
    expect(new Set(SCOPE_PRESETS.read).size).toBeLessThan(new Set(SCOPE_PRESETS.operate).size);
    expect(new Set(SCOPE_PRESETS.operate).size).toBeLessThan(new Set(SCOPE_PRESETS.full).size);
  });

  it("every ordered preset has a scope set", () => {
    for (const key of SCOPE_PRESET_ORDER) {
      expect(SCOPE_PRESETS[key]?.length).toBeGreaterThan(0);
    }
  });

  it("the flight preset is defined but held out of the picker until the flight plane lands", () => {
    // `full` grants flight/destructive; the picker must not offer it while the
    // server has no flight tools to honor it (no fabricated reading). It stays defined for later.
    expect(SCOPE_PRESET_ORDER).toEqual(["read", "operate"]);
    expect(SCOPE_PRESETS.full).toBeDefined();
    expect((SCOPE_PRESET_ORDER as readonly string[]).includes("full")).toBe(false);
  });
});

describe("connectRecipe", () => {
  it("is a clone-and-run command with the credential in the client env", () => {
    const recipe = connectRecipe("ados_mc_secret");
    expect(recipe).toContain("ADOS_MCP_TOKEN=ados_mc_secret");
    expect(recipe).toContain("--target fleet");
    expect(recipe).toContain("dist/index.js");
    expect(recipe).toContain("claude mcp add ados -e");
    // no longer an unpublished npm package
    expect(recipe).not.toContain("npx");
    expect(recipe).not.toContain("@altnautica/ados-mcp");
  });
});

describe("local (LAN-direct) recipes", () => {
  const host = "http://drone.local:8080";
  const key = "pk_abc123";

  it("localConnectRecipe targets the agent over the LAN with no cloud", () => {
    const recipe = localConnectRecipe(host, key);
    expect(recipe).toContain("--target agent");
    expect(recipe).toContain(host);
    expect(recipe).toContain(`ADOS_MCP_AGENT_KEY=${key}`);
    // local-first: never the cloud target, never a minted-credential env var
    expect(recipe).not.toContain("--target fleet");
    expect(recipe).not.toContain("--gcs");
    expect(recipe).not.toContain("ADOS_MCP_TOKEN");
  });

  it("localMcpJsonSnippet is agent-mode and reads the key from the environment", () => {
    const snippet = localMcpJsonSnippet(host);
    const parsed = JSON.parse(snippet);
    const server = parsed.mcpServers.ados;
    expect(server.args).toContain("agent");
    expect(server.args).toContain(host);
    expect(server.args).not.toContain("fleet");
    // A committed .mcp.json must never carry the pairing key itself.
    expect(server.env.ADOS_MCP_AGENT_KEY).toBe("${ADOS_MCP_AGENT_KEY}");
    expect(snippet).not.toContain(key);
  });

  it("localVerifyRecipe checks the drone directly, no cloud", () => {
    const recipe = localVerifyRecipe(host, key);
    expect(recipe).toContain("--target agent");
    expect(recipe).toContain("--verify");
    expect(recipe).not.toContain("--gcs");
  });
});

describe("local fleet (many LAN drones, no cloud)", () => {
  it("localFleetConnectRecipe points at the fleet file, no key env (keys are in the file)", () => {
    const recipe = localFleetConnectRecipe("~/.ados/mcp/fleet.json");
    expect(recipe).toContain("--target local-fleet");
    expect(recipe).toContain("~/.ados/mcp/fleet.json");
    expect(recipe).not.toContain("--target fleet ");
    expect(recipe).not.toContain("--gcs");
    expect(recipe).not.toContain("ADOS_MCP_AGENT_KEY");
  });

  it("localFleetVerifyRecipe verifies the fleet locally", () => {
    expect(localFleetVerifyRecipe("~/f.json")).toContain("--target local-fleet");
    expect(localFleetVerifyRecipe("~/f.json")).toContain("--verify");
  });

  it("fleetFileContents serializes each node's host + pairing key", () => {
    const doc = JSON.parse(
      fleetFileContents([
        { deviceId: "a", name: "Alpha", host: "http://10.0.0.10:8080", apiKey: "ka", profile: "drone" },
        { deviceId: "b", host: "http://10.0.0.11:8080", apiKey: "kb" },
      ]),
    );
    expect(doc.version).toBe(1);
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]).toMatchObject({ deviceId: "a", name: "Alpha", host: "http://10.0.0.10:8080", apiKey: "ka" });
    expect(doc.nodes[1]).toMatchObject({ deviceId: "b", apiKey: "kb" });
    expect(doc.nodes[1].name).toBeUndefined();
  });

  it("fleetEnvValue base64-encodes the whole fleet (decodes back to the JSON)", () => {
    const nodes = [{ deviceId: "a", host: "http://10.0.0.10:8080", apiKey: "ka" }];
    const b64 = fleetEnvValue(nodes);
    // Decode the way the connector does (atob → UTF-8 → JSON).
    const doc = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
    expect(doc.nodes[0]).toMatchObject({ deviceId: "a", apiKey: "ka" });
  });

  it("localFleetEnvRecipe is one command with the whole fleet in the env, no file, no cloud", () => {
    const recipe = localFleetEnvRecipe("BLOB==");
    expect(recipe).toContain("-e ADOS_MCP_FLEET=BLOB==");
    expect(recipe).toContain("--target local-fleet");
    expect(recipe).not.toContain("--gcs");
    expect(recipe).not.toContain(".json"); // no file path
    expect(recipe).not.toContain("--discover"); // off by default
  });

  it("localFleetEnvRecipe adds --discover only when opted in", () => {
    expect(localFleetEnvRecipe("B", { discover: true })).toContain("--discover");
    expect(localFleetEnvRecipe("B", { discover: false })).not.toContain("--discover");
  });
});
