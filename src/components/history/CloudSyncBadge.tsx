"use client";

/**
 * Inline cloud-sync status indicator for the History toolbar.
 *
 * Reads from {@link useHistoryStore} sync state. Authentication and Convex
 * availability come from the standard hooks. Click the badge to force a
 * re-sync (no-op when local-only).
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Cloud, CloudOff, RefreshCcw } from "lucide-react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useAuthStore } from "@/stores/auth-store";
import { useHistoryStore } from "@/stores/history-store";

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function CloudSyncBadge() {
  const t = useTranslations("history");
  const convexAvailable = useConvexAvailable();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const syncStatus = useHistoryStore((s) => s.syncStatus);
  const lastSyncAt = useHistoryStore((s) => s.lastSyncAt);
  const lastSyncError = useHistoryStore((s) => s.lastSyncError);
  const records = useHistoryStore((s) => s.records);
  const markDirty = useHistoryStore((s) => s.markDirty);

  const enabled = convexAvailable && isAuthenticated;

  if (!enabled) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-mono text-text-tertiary"
        title="Sign in with Convex sync to keep flights in the cloud"
      >
        <CloudOff size={11} />
        {t("syncLocalOnly")}
      </span>
    );
  }

  if (syncStatus === "syncing") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-mono text-accent-primary">
        <RefreshCcw size={11} className="animate-spin" />
        {t("syncSyncing")}
      </span>
    );
  }

  if (syncStatus === "error") {
    return (
      <button
        onClick={() => {
          // Mark every record dirty to force a fresh push.
          for (const r of records) markDirty(r.id);
        }}
        className="inline-flex items-center gap-1 text-[10px] font-mono text-status-error hover:text-status-error/80"
        title={lastSyncError ?? "Sync error"}
      >
        <CloudOff size={11} />
        {t("syncError")}
      </button>
    );
  }

  return (
    <button
      onClick={() => {
        for (const r of records) markDirty(r.id);
      }}
      className="inline-flex items-center gap-1 text-[10px] font-mono text-status-success hover:text-status-success/80"
      title={t("syncManual")}
    >
      <Cloud size={11} />
      {lastSyncAt ? t("syncSynced", { time: fmtTime(lastSyncAt) }) : "Synced"}
    </button>
  );
}
