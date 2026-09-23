/**
 * Policy gate for the plugin `cloud.read` method.
 *
 * A plugin half can ask the GCS to run a Convex function on its behalf. That is
 * a privileged bridge into the operator's backend, so it is fenced three ways,
 * all enforced here as pure policy (the handler that owns the live Convex
 * client calls these before dispatching; this module never touches Convex):
 *
 *   1. Allowlist  — only the named functions in {@link ALLOWED_CLOUD_READS}
 *                   may run. Everything else is denied by default. The list
 *                   is deliberately tiny and
 *                   carry only clearly-public, non-sensitive functions: never
 *                   anything user-PII, auth, or `cmd*` admin.
 *   2. Validation — args must be a small JSON-serialisable object.
 *   3. Rate limit — a per-plugin fixed window caps call volume.
 *
 * Function names use Convex's `module:export` form (e.g.
 * `clientConfig:getClientConfig`), matching the keys the handler resolves
 * against the generated api surface.
 *
 * @license GPL-3.0-only
 */

/**
 * Public Convex queries a plugin may read.
 *
 * Each is a no-auth `query` that returns non-sensitive, already-public data:
 *   - `clientConfig:getClientConfig` — public client config (map tokens, etc.).
 *   - `communityChangelog:list`      — published community changelog entries.
 *   - `communityItems:list`          — public community roadmap items.
 *
 * Candidates intentionally LEFT OUT (auth-gated or PII-bearing): anything in
 * `profiles:*`, `comments:*` (user identity), `cmdAiUsage:*`, and every `cmd*`
 * fleet/admin function. Add a name here only after confirming the underlying
 * function is a public query with no `getAuthUserId` / `requireAdmin` gate.
 */
export const ALLOWED_CLOUD_READS: ReadonlySet<string> = new Set([
  "clientConfig:getClientConfig",
  "communityChangelog:list",
  "communityItems:list",
]);

/** Max serialised byte size of a single call's args. */
export const MAX_CLOUD_ARGS_BYTES = 16 * 1024;
/** Max length of any single string field inside args. */
export const MAX_CLOUD_STRING_LEN = 4 * 1024;

/** Fixed-window rate limit: max calls per plugin per window. */
export const CLOUD_RATE_LIMIT_MAX = 30;
/** Rate-limit window length, in milliseconds. */
export const CLOUD_RATE_LIMIT_WINDOW_MS = 60_000;

export function isAllowedCloudRead(fn: string): boolean {
  return ALLOWED_CLOUD_READS.has(fn);
}

type ValidateResult =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Validate the args object a plugin wants to pass to a Convex function.
 *
 * Requires a plain object (Convex function args are always an object), bounds
 * the serialised size, and bounds every string field's length. Rejects
 * non-serialisable values (functions, symbols, bigint, circular refs).
 */
export function validateCloudArgs(fn: string, args: unknown): ValidateResult {
  void fn;
  if (args === undefined || args === null) {
    // Treat "no args" as an empty object — many queries take none.
    return { ok: true, args: {} };
  }
  if (!isPlainObject(args)) {
    return { ok: false, reason: "args must be a plain object" };
  }

  let serialised: string;
  try {
    serialised = JSON.stringify(args);
  } catch {
    return { ok: false, reason: "args are not JSON-serialisable" };
  }
  if (serialised === undefined) {
    return { ok: false, reason: "args are not JSON-serialisable" };
  }
  // Byte length, not code-unit length, so multibyte strings count honestly.
  const byteLen = new TextEncoder().encode(serialised).length;
  if (byteLen > MAX_CLOUD_ARGS_BYTES) {
    return { ok: false, reason: "args exceed maximum size" };
  }

  for (const value of Object.values(args)) {
    if (typeof value === "string" && value.length > MAX_CLOUD_STRING_LEN) {
      return { ok: false, reason: "a string field exceeds maximum length" };
    }
  }

  return { ok: true, args };
}

interface RateWindow {
  windowStart: number;
  count: number;
}

const rateWindows = new Map<string, RateWindow>();

/**
 * Fixed-window rate limit. Returns `true` when the call is allowed (and counts
 * it), `false` when the plugin has exhausted its window. `now` is injected so
 * callers/tests control the clock — this never reads the wall clock itself.
 */
export function checkCloudRateLimit(pluginId: string, now: number): boolean {
  const existing = rateWindows.get(pluginId);
  if (existing === undefined || now - existing.windowStart >= CLOUD_RATE_LIMIT_WINDOW_MS) {
    rateWindows.set(pluginId, { windowStart: now, count: 1 });
    return true;
  }
  if (existing.count >= CLOUD_RATE_LIMIT_MAX) {
    return false;
  }
  existing.count += 1;
  return true;
}

/** Clear all per-plugin rate-limit state. For tests. */
export function resetCloudRateLimits(): void {
  rateWindows.clear();
}
