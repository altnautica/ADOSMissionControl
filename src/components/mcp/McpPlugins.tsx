/**
 * @module components/mcp/McpPlugins
 * @description The Plugins landing: the installed plugins that participate in
 * MCP, as cards (trust, exposure, tool/resource/prompt counts) that open the
 * per-plugin page. Distinguishes "no plugin exposes MCP tools" from "no node
 * could be read".
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import { BadgeCheck, Puzzle, ShieldQuestion } from "lucide-react";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { useMcpPluginTools } from "@/lib/plugins/mcp-plugin-tools";

export function McpPlugins() {
  const t = useTranslations("mcp");
  const { plugins, status } = useMcpPluginTools();
  const navigate = useMcpTabStore((s) => s.navigate);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
          <Puzzle size={16} />
          {t("plugins.title")}
        </h2>
        <p className="text-sm text-text-secondary">{t("plugins.subtitle")}</p>
      </header>

      {plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border-default bg-bg-secondary p-6 text-center">
          <p className="text-sm text-text-secondary">
            {status === "loading"
              ? t("plugins.loading")
              : status === "unavailable"
                ? t("plugins.unavailable")
                : t("plugins.empty")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <button
              key={plugin.pluginId}
              type="button"
              onClick={() => navigate({ kind: "plugin", pluginId: plugin.pluginId })}
              className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-secondary p-4 text-left transition-colors hover:bg-bg-tertiary"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium text-text-primary">{plugin.name}</span>
                  {plugin.firstParty ? (
                    <BadgeCheck size={13} className="shrink-0 text-status-success" />
                  ) : (
                    <ShieldQuestion size={13} className="shrink-0 text-status-warning" />
                  )}
                  {!plugin.mcpExposed ? (
                    <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                      {t("plugins.noExpose")}
                    </span>
                  ) : null}
                </div>
                <span className="font-mono text-[11px] text-text-tertiary">
                  {plugin.pluginId} · v{plugin.version}
                </span>
              </div>
              <span className="shrink-0 text-xs text-text-tertiary">
                {t("plugins.toolsCount", { count: plugin.tools.length })}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
