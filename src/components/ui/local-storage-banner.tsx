/**
 * @module LocalStorageBanner
 * @description Dismissible warning banner that alerts users their data is
 * browser-only. Appears after the 3rd mission save when not signed in.
 * Re-shows after 30 days if still not signed in. Dismiss state persists
 * in IndexedDB via settings-store.
 * @license GPL-3.0-only
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, X, Cloud } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { useSettingsStore } from "@/stores/settings-store";

interface LocalStorageBannerProps {
  onSignIn: () => void;
}

export function LocalStorageBanner({ onSignIn }: LocalStorageBannerProps) {
  const t = useTranslations("common");
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const saveCount = useSettingsStore((s) => s.saveCount);
  const bannerDismissed = useSettingsStore((s) => s.bannerDismissed);
  const bannerDismissedAt = useSettingsStore((s) => s.bannerDismissedAt);
  const dismissBanner = useSettingsStore((s) => s.dismissBanner);
  const [localDismissed, setLocalDismissed] = useState(false);

  // Don't show if authenticated
  if (isAuthenticated) return null;

  // Don't show until 3rd save
  if (saveCount < 3) return null;

  // Don't show if dismissed (but re-show after 30 days)
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  if (bannerDismissed && bannerDismissedAt && Date.now() - bannerDismissedAt < thirtyDays) return null;

  // Don't show if locally dismissed this session
  if (localDismissed) return null;

  function handleDismiss() {
    setLocalDismissed(true);
    dismissBanner();
  }

  return (
    <div className="bg-status-warning/10 border-b border-status-warning/20 px-4 py-2 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle size={14} className="text-status-warning shrink-0" />
        <p className="text-xs text-text-primary truncate">
          {t("localStorageBanner.warning")}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onSignIn}
          className="flex items-center gap-1 text-xs text-accent-primary hover:underline"
        >
          <Cloud size={12} />
          {t("localStorageBanner.signInToBackup")}
        </button>
        <button
          onClick={handleDismiss}
          className="text-text-tertiary hover:text-text-secondary"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
