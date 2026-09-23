"use client";

/**
 * @module hooks/use-auth-keystore-sync
 * @description Purges MAVLink signing keys from IndexedDB on every auth
 * state change so a shared machine cannot leak user A's keys to user B.
 *
 * Call once at the app root (layout or ConvexClientProvider).
 *
 * Behavior by transition:
 *   - Anonymous -> Signed in as user U:
 *       purgeForUser(U). Records tagged with a different userId are
 *       deleted. Anonymous records (userId === null) are preserved.
 *   - Signed in as U -> Signed out:
 *       purgeForUser(null). Records tagged with any userId are deleted.
 *       Anonymous records are preserved.
 *   - Signed in as U -> Signed in as V (same browser):
 *       purgeForUser(V). User U's records get deleted.
 *
 * This keeps one user's signing keys from surviving a user switch on a
 * shared device.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useRef } from "react";
import { purgeForUser } from "@/lib/protocol/signing-keystore";
import { useAuthStore } from "@/stores/auth-store";

export function useAuthKeystoreSync(): void {
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isLoading = useAuthStore((s) => s.isLoading);
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (isLoading) return;

    const previous = lastUserIdRef.current;
    if (previous === userId) return; // no change

    lastUserIdRef.current = userId;

    // First call after load: userId is either the current user or null.
    // Either way, run the purge so any stale records from a previous
    // session on this device get cleaned up.
    purgeForUser(userId).catch((err) => {
      console.warn("[signing] keystore purge failed", err);
    });
  }, [userId, isLoading]);
}
