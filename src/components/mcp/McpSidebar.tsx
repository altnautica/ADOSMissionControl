/**
 * @module components/mcp/McpSidebar
 * @description The MCP tab's grouped left rail. Top-level destinations (Overview,
 * Connect, Audit) plus two management segments — Access control (Credentials,
 * Scopes & roles) and Catalog (Built-in tools) — with a pinned "Add to Claude
 * Code" affordance. Access control, built-in tools and plugin tools are
 * first-class segments.
 * @license GPL-3.0-only
 */

"use client";

import { useTranslations } from "next-intl";
import {
  BadgeCheck,
  Bot,
  KeyRound,
  LayoutDashboard,
  type LucideIcon,
  Plug,
  Puzzle,
  ScrollText,
  ShieldCheck,
  ShieldQuestion,
  Wrench,
} from "lucide-react";
import { useMcpTabStore, type McpView } from "@/stores/mcp-tab-store";
import {
  countExposedPlugins,
  filterPlugins,
  useMcpPluginTools,
} from "@/lib/plugins/mcp-plugin-tools";

export function McpSidebar({ credentialCount }: { credentialCount: number }) {
  const t = useTranslations("mcp");
  const view = useMcpTabStore((s) => s.view);
  const navigate = useMcpTabStore((s) => s.navigate);
  const pluginFilter = useMcpTabStore((s) => s.pluginFilter);
  const setPluginFilter = useMcpTabStore((s) => s.setPluginFilter);
  const { plugins } = useMcpPluginTools();
  const filtered = filterPlugins(plugins, pluginFilter);
  const exposedCount = countExposedPlugins(plugins);
  const activePluginId = view.kind === "plugin" ? view.pluginId : null;

  const item = (target: McpView, Icon: LucideIcon, label: string, count?: number) => {
    const active = view.kind === target.kind;
    return (
      <button
        type="button"
        onClick={() => navigate(target)}
        aria-current={active ? "page" : undefined}
        className={`flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
          active
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
        }`}
      >
        <Icon size={15} className="shrink-0" />
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined && count > 0 ? (
          <span className="rounded bg-bg-tertiary px-1.5 text-[10px] tabular-nums text-text-tertiary">
            {count}
          </span>
        ) : null}
      </button>
    );
  };

  const segment = (label: string) => (
    <p className="px-2.5 pt-3 pb-1 font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
      {label}
    </p>
  );

  return (
    <nav
      aria-label={t("sidebar.label")}
      className="flex flex-col gap-0.5 border-b border-border-default p-3 md:w-56 md:shrink-0 md:overflow-y-auto md:border-b-0 md:border-r"
    >
      {item({ kind: "overview" }, LayoutDashboard, t("sections.overview"))}
      {item({ kind: "connect" }, Plug, t("sections.connect"))}

      {segment(t("groups.access"))}
      {item({ kind: "credentials" }, KeyRound, t("sections.credentials"), credentialCount)}
      {item({ kind: "scopes" }, ShieldCheck, t("sections.scopes"))}

      {segment(t("groups.catalog"))}
      {item({ kind: "catalog" }, Wrench, t("sections.builtinTools"))}

      {/* Plugins segment: a clickable header (the landing) + per-plugin rows. */}
      <button
        type="button"
        onClick={() => navigate({ kind: "plugins" })}
        aria-current={view.kind === "plugins" ? "page" : undefined}
        className={`mt-3 flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
          view.kind === "plugins"
            ? "bg-bg-tertiary text-text-primary"
            : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
        }`}
      >
        <Puzzle size={15} className="shrink-0" />
        <span className="flex-1 truncate font-mono text-[10px] uppercase tracking-wide text-text-tertiary">
          {t("groups.plugins")}
        </span>
        {exposedCount > 0 ? (
          <span className="rounded bg-bg-tertiary px-1.5 text-[10px] tabular-nums text-text-tertiary">
            {exposedCount}
          </span>
        ) : null}
      </button>
      {plugins.length > 6 ? (
        <input
          type="text"
          value={pluginFilter}
          onChange={(e) => setPluginFilter(e.target.value)}
          placeholder={t("plugins.filterPlaceholder")}
          className="mx-1 mb-1 rounded border border-border-default bg-bg-secondary px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary"
        />
      ) : null}
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {filtered.map((plugin) => (
          <button
            key={plugin.pluginId}
            type="button"
            onClick={() => navigate({ kind: "plugin", pluginId: plugin.pluginId })}
            aria-current={activePluginId === plugin.pluginId ? "page" : undefined}
            className={`ml-2 flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors ${
              activePluginId === plugin.pluginId
                ? "bg-bg-tertiary text-text-primary"
                : "text-text-secondary hover:bg-bg-secondary hover:text-text-primary"
            }`}
          >
            {plugin.firstParty ? (
              <BadgeCheck size={12} className="shrink-0 text-status-success" />
            ) : (
              <ShieldQuestion size={12} className="shrink-0 text-status-warning" />
            )}
            <span className="flex-1 truncate">{plugin.name}</span>
            {plugin.tools.length > 0 ? (
              <span className="text-[10px] tabular-nums text-text-tertiary">{plugin.tools.length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="mt-2 border-t border-border-default pt-2">
        {item({ kind: "audit" }, ScrollText, t("sections.audit"))}
      </div>

      <button
        type="button"
        onClick={() => navigate({ kind: "connect" })}
        className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-border-default bg-bg-secondary px-2.5 py-2 text-xs font-medium text-text-primary transition-colors hover:bg-bg-tertiary"
      >
        <Bot size={14} />
        {t("sidebar.addToClaudeCode")}
      </button>
    </nav>
  );
}
