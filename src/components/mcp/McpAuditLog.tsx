/**
 * @module components/mcp/McpAuditLog
 * @description The MCP audit log: one row per tool call an AI client made through
 * the connector, newest first, with decision / node / credential / result. Reads
 * the cloud mirror the MCP server pushes; filters client-side. Honest empty state,
 * never fabricated rows (no fabricated reading). The mirror is self-reported by the operator's
 * connector, so a caveat notes it is not an independent record.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { ScrollText } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQueryState } from "@/hooks/use-convex-skip-query";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { timeAgo } from "@/lib/plan-library";
import type { McpTokenRow } from "./McpConsole";

type AuditDecision = "allowed" | "denied" | "confirmed" | "operator_absent";

export interface McpAuditRow {
  _id: string;
  tokenId: string;
  tool: string;
  node: string;
  decision: AuditDecision;
  result: string;
  plane: string;
  latencyMs: number;
  tsUs: number;
  createdAt: number;
  argsRedacted: boolean;
  sensitiveRead: boolean;
}

const DECISION_CLASS: Record<AuditDecision, string> = {
  allowed: "bg-status-success/15 text-status-success",
  confirmed: "bg-accent-primary/15 text-accent-primary",
  denied: "bg-status-error/15 text-status-error",
  operator_absent: "bg-status-warning/15 text-status-warning",
};

export function McpAuditLog({ credentials }: { credentials: McpTokenRow[] }) {
  const t = useTranslations("mcp");
  const audit = useConvexSkipQueryState(communityApi.mcpTokens.recentAudit, {
    enabled: true,
    args: { limit: 200 },
  });
  const live = audit.data as McpAuditRow[] | undefined;
  // Only an answered query may be read as "no activity". A query still loading,
  // skipped (no deployment) or failed on the server has no rows to show.
  const answered = audit.state === "ready" && live !== undefined;

  const rows = useMemo<McpAuditRow[]>(() => live ?? [], [live]);

  const [decision, setDecision] = useState<string>("all");
  const [token, setToken] = useState<string>("all");
  const [q, setQ] = useState("");

  // Map a credential's tokenId to its human label so the filter reads by name, not
  // an opaque id (the operator named it "Claude on my laptop", not "mct_x8Kf…").
  const labelFor = useMemo(
    () => new Map(credentials.map((c) => [c.tokenId, c.label] as const)),
    [credentials],
  );
  const tokenIds = useMemo(
    () => Array.from(new Set(rows.map((r) => r.tokenId))),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (decision !== "all" && r.decision !== decision) return false;
      if (token !== "all" && r.tokenId !== token) return false;
      if (needle && !`${r.tool} ${r.node} ${r.result}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [rows, decision, token, q]);

  const decisionOptions = [
    { value: "all", label: t("audit.allDecisions") },
    ...(["allowed", "confirmed", "denied", "operator_absent"] as const).map((d) => ({
      value: d,
      label: t(`audit.decision.${d}`),
    })),
  ];
  const tokenOptions = [
    { value: "all", label: t("audit.allCredentials") },
    ...tokenIds.map((id) => ({ value: id, label: labelFor.get(id) ?? id })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-text-primary">{t("audit.title")}</h2>
        <p className="text-sm text-text-secondary">{t("audit.subtitle")}</p>
        <p className="text-xs text-text-tertiary">{t("audit.selfReported")}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Select label={t("audit.filterDecision")} options={decisionOptions} value={decision} onChange={setDecision} />
        </div>
        <div className="w-56">
          <Select label={t("audit.filterCredential")} options={tokenOptions} value={token} onChange={setToken} />
        </div>
        <div className="min-w-48 flex-1">
          <Input
            label={t("audit.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("audit.searchPlaceholder")}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-border-default bg-bg-secondary py-12 text-center">
          <ScrollText size={22} className="text-text-tertiary" />
          <p className="text-sm text-text-secondary">
            {!answered
              ? audit.state === "loading"
                ? t("audit.loading")
                : t("audit.unavailable")
              : rows.length === 0
                ? t("audit.empty")
                : t("audit.noMatch")}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {filtered.map((r) => (
            <div
              key={r._id}
              className="flex items-center gap-3 rounded-lg border border-border-default bg-bg-secondary px-3 py-2"
            >
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${DECISION_CLASS[r.decision]}`}>
                {t(`audit.decision.${r.decision}`)}
              </span>
              <span className="shrink-0 font-mono text-xs text-text-primary">{r.tool}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-text-secondary">{r.result}</span>
              <span className="hidden shrink-0 font-mono text-[11px] text-text-tertiary sm:inline">{r.node}</span>
              {r.sensitiveRead ? (
                <span className="shrink-0 rounded bg-status-warning/15 px-1.5 py-0.5 text-[10px] text-status-warning">
                  {t("audit.secret")}
                </span>
              ) : null}
              <span className="shrink-0 text-[11px] text-text-tertiary" title={formatDate(r.createdAt)}>
                {timeAgo(r.createdAt)}
              </span>
              <span className="hidden shrink-0 font-mono text-[11px] text-text-tertiary md:inline">{r.latencyMs}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
