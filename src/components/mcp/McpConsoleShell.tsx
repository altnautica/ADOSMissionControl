/**
 * @module components/mcp/McpConsoleShell
 * @description The MCP console shell: the grouped sidebar rail over the tab
 * surface, routing the active view (Overview / Connect / Access control /
 * Catalog / Audit). The generate and reveal dialogs stay mounted by the page.
 * @license GPL-3.0-only
 */

"use client";

import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { credentialStatus } from "./mcp-shared";
import { McpSidebar } from "./McpSidebar";
import { McpOverview } from "./McpOverview";
import { McpConnect } from "./McpConnect";
import { McpConsole, type McpTokenRow } from "./McpConsole";
import { McpCredentialDetail } from "./McpCredentialDetail";
import { McpScopesReference } from "./McpScopesReference";
import { McpToolsCatalog } from "./McpToolsCatalog";
import { McpPlugins } from "./McpPlugins";
import { McpPluginDetail } from "./McpPluginDetail";
import { McpAuditLog } from "./McpAuditLog";

export function McpConsoleShell({ rows }: { rows: McpTokenRow[] }) {
  const view = useMcpTabStore((s) => s.view);
  useClockTick();
  const now = useClockStore((s) => s.now);
  const activeCredentials = rows.filter((r) => credentialStatus(r, now) === "active").length;

  return (
    <div className="flex flex-1 flex-col overflow-hidden md:flex-row">
      <McpSidebar credentialCount={activeCredentials} />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-8">
          {view.kind === "overview" && <McpOverview rows={rows} />}
          {view.kind === "connect" && <McpConnect />}
          {view.kind === "credentials" && <McpConsole rows={rows} />}
          {view.kind === "scopes" && <McpScopesReference />}
          {view.kind === "catalog" && <McpToolsCatalog credentials={rows} />}
          {view.kind === "plugins" && <McpPlugins />}
          {view.kind === "plugin" && <McpPluginDetail pluginId={view.pluginId} />}
          {view.kind === "audit" && <McpAuditLog credentials={rows} />}
        </div>
      </div>
      <McpCredentialDetail rows={rows} />
    </div>
  );
}
