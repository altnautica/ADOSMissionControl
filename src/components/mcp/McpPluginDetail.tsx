/**
 * @module components/mcp/McpPluginDetail
 * @description A plugin's MCP page: its exposed tools / resources / prompts, its
 * trust (first-party signer vs untrusted), the nodes it is installed on, and its
 * granted capabilities. Read-only — plugin lifecycle stays on the node-detail
 * Plugins surface. Data comes from the plugin registry (mcp-plugin-tools), never
 * a live server call.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, BadgeCheck, ShieldQuestion } from "lucide-react";
import { toolSafetyClassBadge } from "./mcp-shared";
import { useMcpPluginTools } from "@/lib/plugins/mcp-plugin-tools";

export function McpPluginDetail({ pluginId }: { pluginId: string }) {
  const t = useTranslations("mcp");
  const { plugins, status } = useMcpPluginTools();
  const plugin = plugins.find((p) => p.pluginId === pluginId) ?? null;

  if (!plugin) {
    return (
      <p className="text-sm text-text-tertiary">
        {status === "loading" ? t("plugins.loading") : t("plugins.notFound")}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-text-primary">{plugin.name}</h2>
          {plugin.firstParty ? (
            <span className="flex items-center gap-1 rounded bg-status-success/15 px-1.5 py-0.5 text-[10px] font-medium text-status-success">
              <BadgeCheck size={11} />
              {t("plugins.firstParty")}
            </span>
          ) : (
            <span className="flex items-center gap-1 rounded bg-status-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-status-warning">
              <ShieldQuestion size={11} />
              {t("plugins.untrusted")}
            </span>
          )}
        </div>
        <p className="font-mono text-xs text-text-tertiary">
          {plugin.pluginId} · v{plugin.version}
        </p>
        {plugin.installedOn.length > 0 ? (
          <p className="text-xs text-text-tertiary">
            {t("plugins.installedOn", { nodes: plugin.installedOn.join(", ") })}
          </p>
        ) : null}
      </header>

      {!plugin.mcpExposed ? (
        <p className="rounded-lg border border-border-default bg-bg-secondary p-3 text-xs text-text-secondary">
          {t("plugins.notExposed")}
        </p>
      ) : null}

      {!plugin.firstParty && plugin.mcpExposed ? (
        <p className="flex items-start gap-2 rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          {t("plugins.untrustedNote")}
        </p>
      ) : null}

      {/* Granted capabilities */}
      <section className="flex flex-col gap-2">
        <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
          {t("plugins.grantedCaps")}
        </h3>
        <div className="flex flex-wrap gap-1">
          {plugin.grantedCaps.map((cap) => (
            <span
              key={cap}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                cap === "mcp.expose"
                  ? "bg-accent-primary/15 text-accent-primary"
                  : "bg-bg-tertiary text-text-secondary"
              }`}
            >
              {cap}
            </span>
          ))}
        </div>
      </section>

      {/* Tools */}
      {plugin.tools.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
            {t("plugins.toolsCount", { count: plugin.tools.length })}
          </h3>
          <div className="flex flex-col gap-1.5">
            {plugin.tools.map((tool) => (
              <div
                key={tool.name}
                className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-secondary p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm text-text-primary">
                    {plugin.pluginId}:{tool.name}
                  </span>
                  {tool.safetyClass ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${toolSafetyClassBadge(tool.safetyClass)}`}
                    >
                      {tool.safetyClass}
                    </span>
                  ) : null}
                  {tool.half ? (
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                      {tool.half}
                    </span>
                  ) : null}
                  <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                    {t("plugins.agentModeOnly")}
                  </span>
                </div>
                {tool.description ? (
                  <p className="text-xs leading-relaxed text-text-secondary">{tool.description}</p>
                ) : null}
                {tool.inputSchema ? (
                  <details className="text-xs text-text-tertiary">
                    <summary className="cursor-pointer select-none">
                      {t("plugins.inputSchema")}
                    </summary>
                    <pre className="mt-1 overflow-x-auto rounded bg-bg-tertiary p-2 font-mono text-[11px] text-text-secondary">
                      {JSON.stringify(tool.inputSchema, null, 2)}
                    </pre>
                  </details>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Resources + prompts */}
      {plugin.resources.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
            {t("plugins.resourcesCount", { count: plugin.resources.length })}
          </h3>
          {plugin.resources.map((r) => (
            <p key={r.uri} className="text-xs text-text-secondary">
              <span className="font-mono">{r.uri}</span>
              {r.mimeType ? <span className="text-text-tertiary"> · {r.mimeType}</span> : null}
            </p>
          ))}
        </section>
      ) : null}

      {plugin.prompts.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
            {t("plugins.promptsCount", { count: plugin.prompts.length })}
          </h3>
          {plugin.prompts.map((p) => (
            <p key={p.name} className="text-xs text-text-secondary">
              <span className="font-mono">{p.name}</span>
              {p.description ? <span className="text-text-tertiary"> · {p.description}</span> : null}
            </p>
          ))}
        </section>
      ) : null}
    </div>
  );
}
