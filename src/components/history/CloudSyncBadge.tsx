"use client";

/**
 * Inline cloud-sync status indicator for the History toolbar.
 *
 * Reads from {@link useHistoryStore} sync state. Authentication and Convex
 * availability come from the standard hooks. Click the badge to force a
 * re-sync (no-op when local-only). Demo mode never syncs, so it reads as
 * local-only and offers no sync action.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";
import { Cloud, CloudOff, RefreshCcw } from "lucide-react";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { useAuthStore } from "@/stores/auth-store";
import { useHistoryStore } from "@/stores/history-store";
import { useSettingsStore } from "@/stores/settings-store";

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
  const pendingCount = useHistoryStore((s) => s.pendingSyncIds.size);
  const records = useHistoryStore((s) => s.records);
  const markDirty = useHistoryStore((s) => s.markDirty);
  const demoMode = useSettingsStore((s) => s.demoMode);

  const enabled = convexAvailable && isAuthenticated && !demoMode;

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

  // Idle: say what is actually true. Records still waiting to go up are not
  // "synced", and nothing has synced until a push has succeeded once.
  const tone =
    pendingCount > 0
      ? "text-status-warning hover:text-status-warning/80"
      : lastSyncAt
        ? "text-status-success hover:text-status-success/80"
        : "text-text-tertiary hover:text-text-secondary";
  const label =
    pendingCount > 0
      ? t("syncPending", { count: pendingCount })
      : lastSyncAt
        ? t("syncSynced", { time: fmtTime(lastSyncAt) })
        : t("syncNotYet");

  return (
    <button
      onClick={() => {
        for (const r of records) markDirty(r.id);
      }}
      className={`inline-flex items-center gap-1 text-[10px] font-mono ${tone}`}
      title={t("syncManual")}
    >
      <Cloud size={11} />
      {label}
    </button>
  );
}
