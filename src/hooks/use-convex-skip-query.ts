"use client";

/**
 * @module use-convex-skip-query
 * @description Wrapper around Convex `useQuery` that automatically skips when
 * Convex is unavailable or the app is in demo mode, and resolves server-side
 * errors to `undefined` instead of crashing the route.
 *
 * Skip rules:
 *   1. Convex backend is unavailable (NEXT_PUBLIC_CONVEX_URL not set or down)
 *   2. The app is in demo mode
 *   3. Caller passed `enabled: false`
 *
 * Local-first contract: a Convex query whose function is missing on the
 * deployment, whose schema rejected the args, or whose handler threw must
 * NOT bubble into the closest Next.js `error.tsx`. The hook traps the
 * synchronous throw from `useQuery`, returns `undefined`, and logs once
 * via `console.warn` so silent failures stay debuggable. Pass
 * `throwOnError: true` to opt back into the throw-and-bubble behaviour
 * (rare; usually for admin tools that must surface a backend regression).
 *
 * @example
 * // Simple: skip in demo mode / when Convex is down; soft-fail otherwise
 * const profile = useConvexSkipQuery(communityApi.profiles.getMyProfile);
 *
 * // With args
 * const status = useConvexSkipQuery(cmdDroneStatusApi.getCloudStatus, {
 *   args: { deviceId },
 *   enabled: !!deviceId,
 * });
 *
 * // Auth-gated (still skips in demo + no-convex; soft-fail if listMine 404s)
 * const usage = useConvexSkipQuery(communityApi.aiUsage.getRemaining, {
 *   enabled: isAuthenticated,
 * });
 *
 * @license GPL-3.0-only
 */

import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { useConvexAvailable } from "@/hooks/use-convex-available";
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
 * - `throwOnError`: When `true`, the hook re-throws server errors instead of
 *   resolving to `undefined`. Default `false`. Use only when a missing or
 *   broken backend function should hard-fail the page.
 */
interface UseConvexSkipQueryOptions<Args> {
  args?: Args;
  enabled?: boolean;
  skipDemoCheck?: boolean;
  throwOnError?: boolean;
}

// Module-scoped dedupe set so we warn once per distinct error message
// per session. Page navigations re-render but the warning stays quiet.
const _loggedErrorKeys = new Set<string>();

function logOnce(message: string): void {
  if (_loggedErrorKeys.has(message)) return;
  _loggedErrorKeys.add(message);
  console.warn(
    `[useConvexSkipQuery] resolved to undefined after server error: ${message}`,
  );
}

/** What a skip-guarded query is doing: skipped (no deployment, demo mode, or
 * disabled), still loading, failed on the server, or answered. */
export type ConvexSkipQueryState = "skipped" | "loading" | "error" | "ready";

/**
 * `useConvexSkipQuery` plus the reason the data is absent, for a caller that
 * must not read a skipped or failed query as "still loading".
 */
export function useConvexSkipQueryState<
  Query extends FunctionReference<"query">,
>(
  query: Query,
  options?: UseConvexSkipQueryOptions<Query["_args"]>,
): { data: Query["_returnType"] | undefined; state: ConvexSkipQueryState } {
  const convexAvailable = useConvexAvailable();
  const demo = isDemoMode();

  const enabled = options?.enabled ?? true;
  const skipDemoCheck = options?.skipDemoCheck ?? false;
  const args = options?.args;
  const throwOnError = options?.throwOnError ?? false;

  const shouldSkip = !convexAvailable || (!skipDemoCheck && demo) || !enabled;
  const queryArgs = shouldSkip ? ("skip" as unknown) : ((args ?? {}) as unknown);

  const { data, failed } = useGuardedQuery(query, queryArgs, throwOnError);
  if (failed) return { data: undefined, state: "error" };
  if (shouldSkip) return { data: undefined, state: "skipped" };
  return { data, state: data === undefined ? "loading" : "ready" };
}

/**
 * `useQuery`, but a server-side failure reads as `failed` instead of throwing.
 * `useQuery` throws synchronously during render when the deployment is
 * missing the function, the args fail validation, or the handler threw; the
 * calling page then sees "no data" instead of black-screening to the nearest
 * error.tsx. The skip path never throws.
 */
function useGuardedQuery<Query extends FunctionReference<"query">>(
  query: Query,
  queryArgs: unknown,
  throwOnError: boolean,
): { data: Query["_returnType"] | undefined; failed: boolean } {
  try {
    return { data: useQuery(query, queryArgs as never), failed: false };
  } catch (err) {
    if (throwOnError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    logOnce(message);
    return { data: undefined, failed: true };
  }
}

export function useConvexSkipQuery<
  Query extends FunctionReference<"query">,
>(
  query: Query,
  options?: UseConvexSkipQueryOptions<Query["_args"]>,
): Query["_returnType"] | undefined {
  return useConvexSkipQueryState(query, options).data;
}

// Re-export the empty-object type alias for callers that build options
// programmatically (kept stable for external consumers).
export type { EmptyObject };
