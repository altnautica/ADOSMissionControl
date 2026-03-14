"use client";

import { useQuery } from "convex/react";
import { communityApi } from "@/lib/community-api";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { isDemoMode } from "@/lib/utils";

export function useIsAdmin(): boolean {
  const convexAvailable = useConvexAvailable();
  const demo = isDemoMode();
  const profile = useQuery(
    communityApi.profiles.getMyProfile,
    !demo && convexAvailable ? {} : "skip"
  );
  return profile?.role === "admin";
}
