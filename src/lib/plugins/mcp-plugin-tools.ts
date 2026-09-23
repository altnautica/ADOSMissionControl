/**
 * @module plugins/mcp-plugin-tools
 * @description The per-plugin MCP view the console's Plugins segment renders: a
 * plugin's exposed tools / resources / prompts, its trust (first-party signer vs
 * untrusted), and whether it holds the mcp.expose capability.
 *
 * Source: every LAN-paired node's own plugin list and plugin detail
 * (`GET /api/plugins`, `GET /api/plugins/{id}`: granted capabilities plus the
 * manifest's MCP contributions), the same read the MCP server uses to register
 * plugin tools. When no node answers, the view reports discovery as
 * unavailable rather than claiming no plugin exposes tools. Demo mode loads the
 * demo set.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { isDemoMode } from "@/lib/utils";
import { PluginAgentClient, type PluginAgentManifestDetail } from "@/lib/agent/plugin-client";
import { isEnrolledFirstPartySigner } from "@/lib/plugins/signing-keys";
import { useLocalNodesStore } from "@/stores/local-nodes-store";
import {
  parsePromptContributions,
  parseResourceContributions,
  parseToolContributions,
  type ParsedPromptContribution,
  type ParsedResourceContribution,
  type ParsedToolContribution,
} from "@/lib/plugins/contributions/parse";

/** One installed plugin's MCP surface, aggregated across the nodes it is on. */
export interface McpPluginView {
  pluginId: string;
  name: string;
  version: string;
  /** Signed by a first-party (allowlisted) publisher. Untrusted otherwise. */
  firstParty: boolean;
  /** Holds the mcp.expose capability (its tools are exposed to AI clients). */
  mcpExposed: boolean;
  /** The plugin's granted platform capabilities. */
  grantedCaps: string[];
  /** The node ids the plugin is installed on. */
  installedOn: string[];
  tools: ParsedToolContribution[];
  resources: ParsedResourceContribution[];
  prompts: ParsedPromptContribution[];
}

/** Where plugin discovery stands: still reading, read at least one node, or no
 * node could be read at all. */
export type McpPluginDiscovery = "loading" | "ready" | "unavailable";

/** One node's plugin details, as read from its agent. */
export interface NodePluginDetails {
  nodeId: string;
  details: readonly PluginAgentManifestDetail[];
}

/**
 * Aggregate the plugins that declare any MCP tool, resource or prompt across
 * the nodes read. A plugin on several nodes is one view listing each node; it
 * reads as exposed and first-party only if every node agrees.
 */
export function buildMcpPluginViews(nodes: readonly NodePluginDetails[]): McpPluginView[] {
  const byId = new Map<string, McpPluginView>();
  for (const { nodeId, details } of nodes) {
    for (const d of details) {
      const tools = parseToolContributions(d.manifest.mcp?.tools) ?? [];
      const resources = parseResourceContributions(d.manifest.mcp?.resources) ?? [];
      const prompts = parsePromptContributions(d.manifest.mcp?.prompts) ?? [];
      if (tools.length + resources.length + prompts.length === 0) continue;
      const grantedCaps = d.granted_capabilities ?? [];
      const mcpExposed = grantedCaps.includes("mcp.expose");
      const firstParty = isEnrolledFirstPartySigner(d.install.signer_id);
      const prior = byId.get(d.manifest.id);
      if (prior) {
        prior.installedOn.push(nodeId);
        prior.mcpExposed = prior.mcpExposed && mcpExposed;
        prior.firstParty = prior.firstParty && firstParty;
        continue;
      }
      byId.set(d.manifest.id, {
        pluginId: d.manifest.id,
        name: d.manifest.name,
        version: d.manifest.version,
        firstParty,
        mcpExposed,
        grantedCaps: [...grantedCaps],
        installedOn: [nodeId],
        tools,
        resources,
        prompts,
      });
    }
  }
  return [...byId.values()];
}

/** Read one node's plugin details. A plugin whose detail cannot be read is
 * skipped; a node whose list cannot be read yields null. */
async function readNode(deviceId: string, hostname: string, apiKey: string): Promise<NodePluginDetails | null> {
  const client = new PluginAgentClient(hostname, apiKey);
  let installs: { plugin_id: string }[];
  try {
    installs = (await client.list()).installs;
  } catch {
    return null;
  }
  const details = await Promise.all(
    installs.map((i) => client.get(i.plugin_id).catch(() => null)),
  );
  return {
    nodeId: deviceId,
    details: details.filter((d): d is PluginAgentManifestDetail => d !== null),
  };
}

interface McpPluginState {
  plugins: McpPluginView[];
  status: McpPluginDiscovery | "idle";
  load: () => Promise<void>;
}

/** Shared by every Plugins surface so the fleet is read once, not per mount. */
export const useMcpPluginStore = create<McpPluginState>()((set, get) => ({
  plugins: [],
  status: "idle",
  load: async () => {
    if (get().status === "loading") return;
    set({ status: "loading" });
    if (isDemoMode()) {
      const { getDemoMcpPlugins } = await import("@/mock/mock-mcp-plugins");
      set({ plugins: getDemoMcpPlugins(), status: "ready" });
      return;
    }
    const nodes = useLocalNodesStore
      .getState()
      .nodes.filter((n) => n.hostname && n.apiKey);
    const read = (
      await Promise.all(nodes.map((n) => readNode(n.deviceId, n.hostname, n.apiKey)))
    ).filter((r): r is NodePluginDetails => r !== null);
    set({
      plugins: buildMcpPluginViews(read),
      status: read.length > 0 ? "ready" : "unavailable",
    });
  },
}));

/**
 * The operator's installed plugins that participate in MCP, for the console's
 * Plugins segment, plus where discovery stands.
 */
export function useMcpPluginTools(): { plugins: McpPluginView[]; status: McpPluginDiscovery } {
  const plugins = useMcpPluginStore((s) => s.plugins);
  const status = useMcpPluginStore((s) => s.status);
  const load = useMcpPluginStore((s) => s.load);
  useEffect(() => {
    if (status === "idle") void load();
  }, [status, load]);
  return { plugins, status: status === "idle" ? "loading" : status };
}

/** The count the Plugins segment badges: plugins that expose MCP tools. */
export function countExposedPlugins(plugins: readonly McpPluginView[]): number {
  return plugins.filter((p) => p.mcpExposed).length;
}

/** Filter plugins by a case-insensitive name/id match (the rail filter box). */
export function filterPlugins(
  plugins: readonly McpPluginView[],
  query: string,
): McpPluginView[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...plugins];
  return plugins.filter(
    (p) => p.name.toLowerCase().includes(q) || p.pluginId.toLowerCase().includes(q),
  );
}
