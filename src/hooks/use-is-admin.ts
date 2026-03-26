"use client";

import { communityApi } from "@/lib/community-api";
import { useConvexSkipQuery } from "./use-convex-skip-query";

export function useIsAdmin(): boolean {
  const profile = useConvexSkipQuery(communityApi.profiles.getMyProfile);
  return profile?.role === "admin";
}
