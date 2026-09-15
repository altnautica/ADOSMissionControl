/**
 * @module plugins/mcp-plugin-tools
 * @description The per-plugin MCP view the console's Plugins segment renders: a
 * plugin's exposed tools / resources / prompts, its trust (first-party signer vs
 * untrusted), and whether it holds the mcp.expose capability. The tool
 * declarations are parsed from a plugin manifest by the contribution parsers
 * (mcp-plugin-tools carries the shape; the producer sources them).
 *
 * HONEST SOURCE (Rule 44): a plugin's MCP tools are not carried on the install
 * rows (Convex / local-installs store hold slot contributions + granted caps,
 * not tool declarations), so the fleet-wide real-mode producer that reads each
 * node's live manifest is a follow-on. Today the hook is demo-backed: in demo
 * mode it returns the mock MCP plugins; in real mode it returns an empty set so
 * the segment shows an honest empty state rather than fabricated tools.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { isDemoMode } from "@/lib/utils";
import { getDemoMcpPlugins } from "@/mock/mock-mcp-plugins";
import type {
  ParsedPromptContribution,
  ParsedResourceContribution,
  ParsedToolContribution,
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

/**
 * The operator's installed plugins that participate in MCP, for the console's
 * Plugins segment. Demo-backed today (see the module note); the real-mode
 * fleet-wide producer that reads each node's live manifest is a follow-on.
 */
export function useMcpPluginTools(): McpPluginView[] {
  return useMemo(() => {
    if (isDemoMode()) return getDemoMcpPlugins();
    return [];
  }, []);
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
