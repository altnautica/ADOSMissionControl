/**
 * @module components/mcp/McpToolsCatalog
 * @description The MCP Tools catalog: the built-in tools an AI client can call
 * through the connector, with search, group-by (namespace / safety class /
 * scope), and an optional credential can-call indicator. Honest by construction
 * (no fabricated reading) — it renders a committed snapshot exported from the connector
 * (src/data/mcp/tools-catalog.json), NOT a live fetch, and the can-call marks are
 * a client-side capability check via mcp-scope-model, never a live call.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Wrench, Search, Check, X } from "lucide-react";
import catalog from "@/data/mcp/tools-catalog.json";
import { Select } from "@/components/ui/select";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { credentialStatus, safetyClassBadge } from "./mcp-shared";
import { canCredentialCallTool } from "./mcp-scope-model";
import type { McpTokenRow } from "./McpConsole";

interface CatalogTool {
  name: string;
  group: string;
  scope: string;
  safetyClass: string;
  description: string;
  agentModeOnly?: boolean;
  affectsFlight?: boolean;
}

type GroupBy = "namespace" | "safety" | "scope";

export function McpToolsCatalog({ credentials = [] }: { credentials?: McpTokenRow[] }) {
  const t = useTranslations("mcp");
  const tools = catalog.tools as CatalogTool[];
  const [search, setSearch] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("namespace");
  const [credId, setCredId] = useState("");
  useClockTick();
  const now = useClockStore((s) => s.now);

  const cred =
    credentials.find((c) => c.tokenId === credId && credentialStatus(c, now) === "active") ?? null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (x) => x.name.toLowerCase().includes(q) || x.description.toLowerCase().includes(q),
    );
  }, [tools, search]);

  const groups = useMemo(() => {
    const keyOf = (x: CatalogTool) =>
      groupBy === "namespace" ? x.group : groupBy === "safety" ? x.safetyClass : x.scope;
    const m = new Map<string, CatalogTool[]>();
    for (const x of filtered) {
      const k = keyOf(x);
      const arr = m.get(k);
      if (arr) arr.push(x);
      else m.set(k, [x]);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered, groupBy]);

  const canCall = (x: CatalogTool) =>
    cred
      ? canCredentialCallTool(
          { scopes: cred.scopes, allowedNodes: cred.allowedNodes },
          { name: x.name, scope: x.scope, safetyClass: x.safetyClass, agentModeOnly: x.agentModeOnly, affectsFlight: x.affectsFlight },
          // A minted credential only connects through the fleet relay.
          { flightEnforced: false, fleetMode: true },
        )
      : null;

  const groupByOptions = [
    { value: "namespace", label: t("tools.byNamespace") },
    { value: "safety", label: t("tools.bySafety") },
    { value: "scope", label: t("tools.byScope") },
  ];
  const credOptions = [
    { value: "", label: t("tools.noCredential") },
    ...credentials
      .filter((c) => credentialStatus(c, now) === "active")
      .map((c) => ({ value: c.tokenId, label: c.label })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">{t("tools.title")}</h2>
        <p className="text-sm text-text-secondary">
          {t("tools.subtitle", { version: catalog.version, count: catalog.toolCount })}
        </p>
        <p className="text-xs text-text-tertiary">{t("tools.scopeNote")}</p>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="relative flex flex-1 items-center">
          <Search size={14} className="absolute left-2.5 text-text-tertiary" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("tools.searchPlaceholder")}
            className="w-full rounded-md border border-border-default bg-bg-secondary py-1.5 pl-8 pr-2 text-sm text-text-primary placeholder:text-text-tertiary"
          />
        </label>
        <Select
          label={t("tools.groupBy")}
          options={groupByOptions}
          value={groupBy}
          onChange={(v) => setGroupBy(v as GroupBy)}
          className="sm:w-44"
        />
        {credentials.length > 0 ? (
          <Select
            label={t("tools.credentialFilter")}
            options={credOptions}
            value={credId}
            onChange={setCredId}
            searchable={credentials.length > 8}
            className="sm:w-52"
          />
        ) : null}
      </div>

      {groups.length === 0 ? (
        <p className="text-sm text-text-tertiary">{t("tools.noMatch")}</p>
      ) : (
        groups.map(([group, groupTools]) => (
          <section key={group} className="flex flex-col gap-2">
            <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
              {group} <span className="text-text-tertiary/60">({groupTools.length})</span>
            </h3>
            <div className="flex flex-col gap-1.5">
              {groupTools.map((tool) => {
                const call = canCall(tool);
                return (
                  <div
                    key={tool.name}
                    className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-secondary p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm text-text-primary">{tool.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${safetyClassBadge(tool.safetyClass)}`}
                      >
                        {tool.safetyClass}
                      </span>
                      {tool.agentModeOnly ? (
                        <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-tertiary">
                          {t("tools.agentOnly")}
                        </span>
                      ) : null}
                      {tool.affectsFlight ? (
                        <span className="rounded bg-status-error/15 px-1.5 py-0.5 text-[10px] text-status-error">
                          {t("tools.flight")}
                        </span>
                      ) : null}
                      {call ? (
                        <span
                          className={`ml-auto flex items-center gap-1 text-[11px] ${call.callable ? "text-status-success" : "text-text-tertiary"}`}
                        >
                          {call.callable ? <Check size={12} /> : <X size={12} />}
                          {call.callable ? t("tools.callable") : t("tools.blocked")}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-xs leading-relaxed text-text-secondary">{tool.description}</p>
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      <p className="flex items-center gap-1.5 text-xs text-text-tertiary">
        <Wrench size={12} />
        {t("tools.snapshotNote")}
      </p>
    </div>
  );
}
