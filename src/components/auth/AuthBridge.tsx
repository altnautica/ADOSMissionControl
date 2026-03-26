/**
 * @module AuthBridge
 * @description Syncs Convex auth state to the Zustand auth store.
 * Renders nothing. Must be mounted inside ConvexAuthNextjsProvider.
 * @license GPL-3.0-only
 */
"use client";

import { useEffect } from "react";
import { useConvexAuth } from "convex/react";
import { useAuthStore } from "@/stores/auth-store";
import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "@/hooks/use-convex-skip-query";

export function AuthBridge() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setStoreLoading = useAuthStore((s) => s.setLoading);
  const zustandAuth = useAuthStore((s) => s.isAuthenticated);

  const profile = useConvexSkipQuery(communityApi.profiles.getMyProfile, {
    enabled: isAuthenticated,
  });

  useEffect(() => {
    setStoreLoading(isLoading);
  }, [isLoading, setStoreLoading]);

  useEffect(() => {
    if (isLoading) return;

    if (isAuthenticated && profile) {
      setAuth({
        id: profile._id ?? "",
        name: profile.fullName ?? profile.email?.split("@")[0] ?? "User",
        email: profile.email ?? "",
      });
    } else if (!isAuthenticated && zustandAuth) {
      setAuth(null);
    }
  }, [isAuthenticated, isLoading, profile, zustandAuth, setAuth]);

  return null;
}
