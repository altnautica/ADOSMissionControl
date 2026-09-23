/**
 * @module PluginCrashBanner
 * @description Global banner that surfaces recent plugin crash events
 * to the operator. Reads `cmd_pluginEvents` (severity error, type
 * crashed) within a rolling 5-minute window via the Convex
 * `recentCrashes` query. Click routes to the plugin detail page so the
 * operator can read the event log and take action.
 *
 * The banner refreshes its window argument every 30 seconds so events
 * fall off the list as they age out. The banner is locally dismissable
 * for the session; a fresh crash re-mounts a new banner because the
 * latest install id changes.
 *
 * @license GPL-3.0-only
 */
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AlertTriangle, X } from "lucide-react";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { communityApi } from "@/lib/community-api";
import { useAuthStore } from "@/stores/auth-store";

const WINDOW_MS = 5 * 60 * 1000;
const REFRESH_MS = 30 * 1000;

export function PluginCrashBanner() {
  const t = useTranslations("plugins");
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [sinceMs, setSinceMs] = useState(WINDOW_MS);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  // Roll the window forward periodically so the query re-runs and
  // crashes that drop out of the 5-minute window stop reporting. Crash
  // events live in the operator's cloud account, so a signed-out session
  // neither subscribes nor rolls the window.
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => {
      setSinceMs(WINDOW_MS + ((Date.now() % REFRESH_MS) | 0));
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [isAuthenticated]);

  const crashes = useConvexSkipQuery(communityApi.plugins.recentCrashes, {
    args: { sinceMs },
    enabled: isAuthenticated,
  });

  if (!crashes || crashes.length === 0) return null;

  const top = crashes[0];
  const dismissKey = `${top.installId}:${top.lastAt}`;
  if (dismissedKey === dismissKey) return null;

  return (
    <div className="bg-status-error/10 border-b border-status-error/20 px-4 py-2 flex items-center justify-between gap-3">
      <button
        type="button"
        onClick={() => router.push(`/config/plugins/${top.installId}`)}
        className="flex items-center gap-2 min-w-0 text-left hover:underline"
      >
        <AlertTriangle size={14} className="text-status-error shrink-0" />
        <p className="text-xs text-text-primary truncate">
          <span className="font-semibold">{t("crashBannerTitle")}</span>
          <span className="ml-2 text-text-secondary">
            {t("crashBannerMessage", { name: top.name })}
          </span>
        </p>
      </button>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => setDismissedKey(dismissKey)}
          aria-label="Dismiss"
          className="text-text-tertiary hover:text-text-secondary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
