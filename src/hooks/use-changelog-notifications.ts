/**
 * @module use-changelog-notifications
 * @description Core hook for changelog notification system. Fetches published
 * entries via Convex, computes unseen vs seenChangelogIds from settings store,
 * manages delayed auto-show, and provides dismiss/disable actions.
 * @license GPL-3.0-only
 */

"use client";

import { useEffect, useRef, useMemo } from "react";
import { communityApi } from "@/lib/community-api";
import { useSettingsStore } from "@/stores/settings-store";
import { useChangelogNotificationStore } from "@/stores/changelog-notification-store";
import { useConvexSkipQuery } from "./use-convex-skip-query";

export interface ChangelogEntry {
  _id: string;
  version: string;
  title: string;
  body: string;
  publishedAt: number;
  tags?: string[];
  authorName: string;
  repo?: string;
}

export function useChangelogNotifications() {
  const allEntries = (useConvexSkipQuery(communityApi.changelog.list) ?? []) as ChangelogEntry[];

  const seenChangelogIds = useSettingsStore((s) => s.seenChangelogIds);
  const changelogNotificationsEnabled = useSettingsStore((s) => s.changelogNotificationsEnabled);
  const hasHydrated = useSettingsStore((s) => s._hasHydrated);
  const onboarded = useSettingsStore((s) => s.onboarded);
  const markChangelogSeen = useSettingsStore((s) => s.markChangelogSeen);
  const setChangelogNotificationsEnabled = useSettingsStore((s) => s.setChangelogNotificationsEnabled);

  const modalOpen = useChangelogNotificationStore((s) => s.modalOpen);
  const setModalOpen = useChangelogNotificationStore((s) => s.setModalOpen);
  const setUnseenCount = useChangelogNotificationStore((s) => s.setUnseenCount);

  // Track the initial onboarded value to detect fresh onboarding this session
  const initialOnboardedRef = useRef<boolean | null>(null);
  if (initialOnboardedRef.current === null && hasHydrated) {
    initialOnboardedRef.current = onboarded;
  }

  const seenSet = useMemo(() => new Set(seenChangelogIds), [seenChangelogIds]);

  const unseenEntries = useMemo(
    () => allEntries.filter((e) => !seenSet.has(e._id)),
    [allEntries, seenSet]
  );

  const unseenCount = unseenEntries.length;

  // Keep volatile store in sync
  useEffect(() => {
    setUnseenCount(unseenCount);
  }, [unseenCount, setUnseenCount]);

  // Auto-open modal after 1.5s delay once hydrated
  const autoShownRef = useRef(false);
  useEffect(() => {
    if (autoShownRef.current) return;
    if (!hasHydrated) return;
    if (!onboarded) return; // WelcomeModal takes priority
    if (!changelogNotificationsEnabled) return;
    if (unseenCount === 0) return;
    // Skip if user just completed onboarding this session
    if (initialOnboardedRef.current === false) return;

    const timer = setTimeout(() => {
      autoShownRef.current = true;
      setModalOpen(true);
    }, 1500);

    return () => clearTimeout(timer);
  }, [hasHydrated, onboarded, changelogNotificationsEnabled, unseenCount, setModalOpen]);

  const dismissAll = () => {
    const allIds = allEntries.map((e) => e._id);
    markChangelogSeen(allIds);
    setModalOpen(false);
  };

  const disableAndDismiss = () => {
    const allIds = allEntries.map((e) => e._id);
    markChangelogSeen(allIds);
    setChangelogNotificationsEnabled(false);
    setModalOpen(false);
  };

  return {
    unseenEntries,
    unseenCount,
    allEntries,
    modalOpen,
    setModalOpen,
    dismissAll,
    disableAndDismiss,
  };
}
