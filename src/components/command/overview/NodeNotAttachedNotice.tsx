"use client";

/**
 * @module NodeNotAttachedNotice
 * @description Shown on a node's overview while this browser's agent
 * connection is not that node's (another node is attached, or none is). The
 * status, services, logs and restart controls read that one connection, so
 * they are withheld rather than shown under this node's name.
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

export function NodeNotAttachedNotice() {
  const t = useTranslations("agent.notAttached");
  return (
    <div
      role="status"
      className="rounded-lg border border-status-warning/40 bg-status-warning/5 p-3 space-y-1"
    >
      <h3 className="text-xs font-semibold uppercase tracking-wide text-status-warning">
        {t("title")}
      </h3>
      <p className="text-xs text-text-secondary">{t("body")}</p>
    </div>
  );
}
