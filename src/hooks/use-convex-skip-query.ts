"use client";

/**
 * @module use-convex-skip-query
 * @description Wrapper around Convex `useQuery` that automatically skips when
 * Convex is unavailable or the app is in demo mode. Eliminates the repetitive
 * `!isDemoMode() && convexAvailable ? args : "skip"` guard pattern.
 *
 * By default, queries are enabled when both conditions hold:
 *   1. Convex backend is available (NEXT_PUBLIC_CONVEX_URL is set)
 *   2. The app is NOT in demo mode
 *
 * Pass an `enabled` option to add extra conditions (e.g. `isAuthenticated`,
 * `!!cloudDeviceId`). The query runs only when the default checks AND the
 * `enabled` value are all truthy.
 *
 * @example
 * // Simple: skip in demo mode / when Convex is down
 * const profile = useConvexSkipQuery(communityApi.profiles.getMyProfile);
 *
 * // With args
 * const status = useConvexSkipQuery(cmdDroneStatusApi.getCloudStatus, {
 *   args: { deviceId },
 *   enabled: !!deviceId,
 * });
 *
 * // Auth-gated (still skips in demo + no-convex)
 * const usage = useConvexSkipQuery(communityApi.aiUsage.getRemaining, {
 *   enabled: isAuthenticated,
 * });
 *
 * @license GPL-3.0-only
 */

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useConvexAvailable } from "@/app/ConvexClientProvider";
import { isDemoMode } from "@/lib/utils";

type EmptyObject = Record<string, never>;

/**
 * Options for `useConvexSkipQuery`.
 *
 * - `args`: The query arguments. Omit (or pass `undefined`) for queries that
 *   take no arguments (empty object `{}` is sent automatically).
 * - `enabled`: Extra boolean guard. When `false`, the query is skipped even if
 *   Convex is available and demo mode is off. Defaults to `true`.
 * - `skipDemoCheck`: When `true`, the demo-mode check is bypassed. Useful for
 *   queries that should run in demo mode when Convex is still available (rare).
 */
interface UseConvexSkipQueryOptions<Args> {
  args?: Args;
  enabled?: boolean;
  skipDemoCheck?: boolean;
}

export function useConvexSkipQuery<
  Query extends FunctionReference<"query">,
>(
  query: Query,
  options?: UseConvexSkipQueryOptions<Query["_args"]>,
): Query["_returnType"] | undefined {
  const convexAvailable = useConvexAvailable();
  const demo = isDemoMode();

  const enabled = options?.enabled ?? true;
  const skipDemoCheck = options?.skipDemoCheck ?? false;
  const args = options?.args;

  const shouldSkip = !convexAvailable || (!skipDemoCheck && demo) || !enabled;

  // Convex useQuery expects either the args object or the literal "skip".
  // For queries with no required args, we pass `{}`.
  return useQuery(
    query,
    shouldSkip ? ("skip" as any) : ((args ?? {}) as any),
  );
}
