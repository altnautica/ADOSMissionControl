/**
 * @module components/mcp/McpCredentialDetail
 * @description The credential detail drawer: a per-token policy view with a
 * "what this token can do" reach preview. The preview is a CLIENT-SIDE
 * CAPABILITY CHECK (no fabricated reading) — it resolves the token's scopes against the
 * committed tools catalog via mcp-scope-model, it is never a live call. A minted
 * credential only connects through the fleet relay (`--target fleet`), so reach
 * is evaluated in fleet mode (agent-only tools are unreachable) with flight
 * enforcement off. A revoked or expired credential can call nothing.
 * @license GPL-3.0-only
 */

"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Check, X } from "lucide-react";
import catalog from "@/data/mcp/tools-catalog.json";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/utils";
import { timeAgo } from "@/lib/plan-library";
import { useMcpTabStore } from "@/stores/mcp-tab-store";
import { useClockStore } from "@/stores/clock-store";
import { useClockTick } from "@/lib/agent/freshness";
import {
  MINTED_CREDENTIAL_REACH,
  SAFETY_CLASSES,
  credentialStatus,
  safetyClassBadge,
} from "./mcp-shared";
import {
  summarizeCredentialReach,
  type BlockReason,
  type ScopeToolDescriptor,
} from "./mcp-scope-model";
import type { McpTokenRow } from "./McpConsole";

const CATALOG_TOOLS: ScopeToolDescriptor[] = (
  catalog.tools as Array<{
    name: string;
    scope: string;
    safetyClass: string;
    agentModeOnly?: boolean;
    affectsFlight?: boolean;
  }>
).map((ttool) => ({
  name: ttool.name,
  scope: ttool.scope,
  safetyClass: ttool.safetyClass,
  agentModeOnly: ttool.agentModeOnly,
  affectsFlight: ttool.affectsFlight,
}));

const BLOCK_REASONS: BlockReason[] = [
  "scope",
  "flight_disabled",
  "agent_mode_only",
  "node_not_allowed",
];

export function McpCredentialDetail({ rows }: { rows: McpTokenRow[] }) {
  const t = useTranslations("mcp");
  const selectedId = useMcpTabStore((s) => s.selectedCredentialId);
  const selectCredential = useMcpTabStore((s) => s.selectCredential);
  useClockTick();
  const now = useClockStore((s) => s.now);

  const row = rows.find((r) => r.tokenId === selectedId) ?? null;

  const status = row ? credentialStatus(row, now) : null;
  const usable = status === "active";

  const reach = useMemo(
    () =>
      row
        ? summarizeCredentialReach(
            { scopes: row.scopes, allowedNodes: row.allowedNodes },
            CATALOG_TOOLS,
            MINTED_CREDENTIAL_REACH,
          )
        : null,
    [row],
  );

  return (
    <Modal
      open={row != null}
      onClose={() => selectCredential(null)}
      title={row?.label ?? ""}
      size="lg"
    >
      {row && reach ? (
        <div className="flex flex-col gap-5">
          {/* Scope groups */}
          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
              {t("credentialDetail.scopeGroups")}
            </h3>
            <div className="flex flex-wrap gap-2">
              {SAFETY_CLASSES.map((group) => {
                const held = row.scopes.includes(group);
                return (
                  <span
                    key={group}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${
                      held ? safetyClassBadge(group) : "bg-bg-tertiary text-text-tertiary line-through"
                    }`}
                  >
                    {held ? <Check size={11} /> : <X size={11} />}
                    {group}
                  </span>
                );
              })}
            </div>
          </section>

          {/* Reach preview */}
          <section className="flex flex-col gap-2">
            <h3 className="font-mono text-xs uppercase tracking-wide text-text-tertiary">
              {t("credentialDetail.reachTitle")}
            </h3>
            {status === "revoked" ? (
              <p className="text-xs text-status-warning">{t("credentialDetail.revokedNote")}</p>
            ) : status === "expired" ? (
              <p className="text-xs text-status-warning">{t("credentialDetail.expiredNote")}</p>
            ) : null}
            <div className="flex flex-col gap-1 rounded-lg border border-border-default bg-bg-secondary p-3">
              <p className="flex items-center gap-1.5 text-sm text-text-primary">
                {usable ? (
                  <Check size={14} className="text-status-success" />
                ) : (
                  <X size={14} className="text-status-error" />
                )}
                {t("credentialDetail.callable", {
                  callable: usable ? reach.callable : 0,
                  total: reach.total,
                })}
              </p>
              {BLOCK_REASONS.filter((r) => reach.byReason[r] > 0).map((r) => (
                <p key={r} className="flex items-center gap-1.5 text-xs text-text-tertiary">
                  <X size={12} className="text-status-error" />
                  {t("credentialDetail.blocked", {
                    count: reach.byReason[r],
                    reason: t(`credentialDetail.reason.${r}`),
                  })}
                </p>
              ))}
            </div>
            <p className="text-[11px] text-text-tertiary">{t("credentialDetail.capabilityNote")}</p>
          </section>

          {/* Metadata */}
          <section className="flex flex-col gap-1.5 text-xs text-text-secondary">
            <div className="flex justify-between gap-4">
              <span className="text-text-tertiary">{t("credentialDetail.allowedNodes")}</span>
              <span className="text-right">
                {row.allowedNodes.length > 0
                  ? row.allowedNodes.join(", ")
                  : t("credentialDetail.allNodes")}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-tertiary">{t("credentialDetail.expires")}</span>
              <span>
                {row.expiresAt != null ? formatDate(row.expiresAt) : t("credentialDetail.never")}
              </span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-text-tertiary">{t("credentialDetail.lastUsedLabel")}</span>
              <span>{row.lastUsedAt != null ? timeAgo(row.lastUsedAt) : t("neverUsed")}</span>
            </div>
          </section>
        </div>
      ) : null}
    </Modal>
  );
}
