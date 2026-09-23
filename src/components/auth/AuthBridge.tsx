/**
 * @module AuthBridge
 * @description Syncs Convex auth state to the Zustand auth store.
 * Renders nothing. Must be mounted inside ConvexAuthNextjsProvider.
 *
 * This component is the only writer of the store's identity. Auth stays
 * marked as loading until the signed-in caller's user id (and profile) have
 * resolved, so nothing downstream ever sees a signed-in session as
 * "loaded with no user". The keystore sync relies on that: a loaded store
 * with a null user means signed out, and purges every account's keys.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthStore } from "@/stores/auth-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";
import { useAuthKeystoreSync } from "@/hooks/use-auth-keystore-sync";

export function AuthBridge() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setStoreLoading = useAuthStore((s) => s.setLoading);
  const zustandAuth = useAuthStore((s) => s.isAuthenticated);

  const userId = useConvexSkipQuery(communityApi.profiles.getMyUserId, {
    enabled: isAuthenticated,
  });
  const profile = useConvexSkipQuery(communityApi.profiles.getMyProfile, {
    enabled: isAuthenticated,
  });
  const identityPending =
    isAuthenticated && (userId === undefined || profile === undefined);

  useEffect(() => {
    setStoreLoading(isLoading || identityPending);
  }, [isLoading, identityPending, setStoreLoading]);

  useEffect(() => {
    if (isLoading || identityPending) return;

    if (isAuthenticated && userId) {
      setAuth({
        id: userId,
        name: profile?.fullName ?? profile?.email?.split("@")[0] ?? "User",
        email: profile?.email ?? "",
      });
    } else if (zustandAuth) {
      // Signed out, or the session no longer maps to a user.
      setAuth(null);
    }
  }, [isAuthenticated, isLoading, identityPending, userId, profile, zustandAuth, setAuth]);

  // Keep the signing keystore in sync with auth. Purges records owned by
  // a different user on every auth state change.
  useAuthKeystoreSync();

  return null;
}
