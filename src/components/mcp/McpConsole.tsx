/**
 * @module components/mcp/McpConsole
 * @description The MCP access-control console: the operator's machine
 * credentials with scope badges, created / last-used times, and a revoke action.
 * A "Generate" button opens the mint dialog. The reveal and generate dialogs are
 * mounted by the page. Credential plaintext is never rendered here.
 * @license GPL-3.0-only
 */

"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { useTranslations } from "next-intl";
import { Plus, KeyRound, Trash2 } from "lucide-react";
import { communityApi } from "@/lib/community-api";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDate } from "@/lib/utils";
import { timeAgo } from "@/lib/plan-library";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import { credentialStatus, type McpCredentialStatus } from "./mcp-shared";

export interface McpTokenRow {
  _id: string;
  tokenId: string;
  scopes: string[];
  allowedNodes: string[];
  label: string;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastUsedAt: number | null;
}

const STATUS_CLASS: Record<McpCredentialStatus, string> = {
  active: "bg-status-success/15 text-status-success",
  revoked: "bg-bg-tertiary text-text-tertiary",
  expired: "bg-status-warning/15 text-status-warning",
};

export function McpConsole({ rows }: { rows: McpTokenRow[] }) {
  const t = useTranslations("mcp");
  const openGenerate = useMcpTabStore((s) => s.openGenerate);
  const revokeTokenId = useMcpTabStore((s) => s.revokeTokenId);
  const askRevoke = useMcpTabStore((s) => s.askRevoke);
  const selectCredential = useMcpTabStore((s) => s.selectCredential);
  const revoke = useMutation(communityApi.mcpTokens.revoke);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useClockTick();
  const now = useClockStore((s) => s.now);

  const pending = rows.find((r) => r.tokenId === revokeTokenId) ?? null;

  // The revoke confirm lives in this section; if the operator leaves the section
  // (or the tab) with it open, drop the pending target so it does not silently
  // re-open when they return.
  useEffect(() => () => askRevoke(null), [askRevoke]);

  async function confirmRevoke() {
    if (!revokeTokenId) return;
    setBusy(true);
    setError(null);
    try {
      await revoke({ tokenId: revokeTokenId });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      // Close the dialog either way: on success the row flips to revoked, on
      // failure the error banner in the console body becomes visible (it would
      // otherwise sit behind the modal backdrop).
      askRevoke(null);
      setBusy(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <header className="flex items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-text-primary">{t("consoleTitle")}</h2>
            <p className="text-sm text-text-secondary">{t("consoleSubtitle")}</p>
          </div>
          <Button icon={<Plus size={16} />} onClick={openGenerate}>
            {t("generateCta")}
          </Button>
        </header>

        {error ? <p className="text-xs text-status-error">{error}</p> : null}

        <div className="flex flex-col gap-2">
          {rows.map((row) => {
            const status = credentialStatus(row, now);
            return (
              <div
                key={row._id}
                className="flex items-center gap-4 rounded-lg border border-border-default bg-bg-secondary p-4"
              >
                <KeyRound size={18} className="shrink-0 text-text-tertiary" />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-text-primary">{row.label}</span>
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${STATUS_CLASS[status]}`}>
                      {t(`status.${status}`)}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {row.scopes.map((scope) => (
                      <span
                        key={scope}
                        className="rounded bg-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-text-secondary"
                      >
                        {scope}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-text-tertiary">
                    <span>{t("createdAt", { date: formatDate(row.createdAt) })}</span>
                    <span>
                      {row.lastUsedAt != null
                        ? t("lastUsed", { ago: timeAgo(row.lastUsedAt) })
                        : t("neverUsed")}
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="secondary" size="sm" onClick={() => selectCredential(row.tokenId)}>
                    {t("credentialDetail.open")}
                  </Button>
                  {status === "active" ? (
                    <Button
                      variant="danger"
                      size="sm"
                      icon={<Trash2 size={14} />}
                      onClick={() => askRevoke(row.tokenId)}
                    >
                      {t("revoke")}
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <ConfirmDialog
        open={revokeTokenId != null}
        onConfirm={confirmRevoke}
        onCancel={() => askRevoke(null)}
        title={t("revokeConfirmTitle")}
        message={t("revokeConfirmBody", { label: pending?.label ?? "" })}
        confirmLabel={t("revoke")}
        variant="danger"
        confirmDisabled={busy}
      />
    </>
  );
}
