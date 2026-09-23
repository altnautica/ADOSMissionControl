/**
 * @module lib/rateLimit
 * @description Attempt counting with escalating lockout for the anonymous
 * Convex surfaces — pairing claims, agent registration, credential
 * verification and the anonymous contact form.
 *
 * Every one of those is reachable without a session, and before this existed
 * nothing in either Convex tree counted a failed attempt at all. A six-character
 * pairing code drawn from a 31-character charset is ~887M combinations; with
 * unlimited attempts inside its 15-minute window that is a guessing target, and
 * the credential-verification action was a free oracle with no lockout.
 *
 * Shape of the policy, and why each part is there:
 *
 *   - A ROLLING WINDOW, not a fixed one. `firstAttemptAt` is reset once the
 *     window elapses with no further attempts, so a slow legitimate caller
 *     never accumulates toward a lockout.
 *   - ESCALATING lockout, doubling per overflow attempt up to a ceiling. A flat
 *     lockout is a fixed-cost speed bump an attacker simply waits out; doubling
 *     makes a sustained campaign cost exponentially more wall-clock while a
 *     human who fat-fingered a code twice waits seconds.
 *   - A CEILING on the doubling. Without one a transient burst locks a
 *     legitimate operator out for days, which is a denial of service the
 *     attacker gets for free.
 *
 * Note the deliberate difference from the agent-side recovery rule (fixed
 * interval, no ladder, no terminal state): that rule governs a vehicle
 * retrying its own hardware, where a growing interval means a longer outage.
 * This is an adversary-facing lockout, where a growing interval is the point.
 * Neither is ever a permanent failed state — `lockedUntil` always expires.
 *
 * Lives in `convex/lib` rather than `src/lib` because `convex/` is a separate
 * tsconfig project. Kept byte-identical between the website superset and the
 * OSS twin.
 *
 * @license GPL-3.0-only
 */

import type { MutationCtx } from "../_generated/server";

export interface RateLimitPolicy {
  /** Attempts permitted inside `windowMs` before lockout begins. */
  maxAttempts: number;
  /** Rolling window, in ms. Idle for this long and the counter resets. */
  windowMs: number;
  /** Lockout applied at the first overflow attempt. Doubles from there. */
  baseLockoutMs: number;
  /** Ceiling on the doubling, so a burst cannot lock a caller out for days. */
  maxLockoutMs: number;
}

/** Anonymous pairing-code claim: the guessing target with the smallest space. */
export const CLAIM_POLICY: RateLimitPolicy = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 30 * 1000,
  maxLockoutMs: 30 * 60 * 1000,
};

/**
 * Backstop against a distributed spray across many browser sessions. Only
 * FAILED claims charge it (checked with `checkBucket` on every claim), and
 * no single caller's success resets it, so a room full of operators pairing
 * correctly never touches it and an attacker cannot clear it by claiming their
 * own device.
 *
 * A GLOBAL bucket is itself a denial-of-service lever — an attacker who trips
 * it locks out every legitimate anonymous pairing too — so the lockout is
 * deliberately short. It buys minutes to notice a spray, not hours of outage.
 */
export const CLAIM_GLOBAL_POLICY: RateLimitPolicy = {
  maxAttempts: 200,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 30 * 1000,
  maxLockoutMs: 5 * 60 * 1000,
};

/**
 * NOVEL agent registrations from one source address. A beacon re-registering a
 * device it already owns is not counted at all (see `registerAgent`), so this
 * bounds only first-contact registrations — the axis a code-guessing attack has
 * to travel, because a second attempt reusing a device id is refused outright.
 */
export const REGISTER_POLICY: RateLimitPolicy = {
  maxAttempts: 10,
  windowMs: 60 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/** Credential verification / authorization probes, per presented credential. */
export const CREDENTIAL_POLICY: RateLimitPolicy = {
  maxAttempts: 10,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 30 * 1000,
  maxLockoutMs: 30 * 60 * 1000,
};

/**
 * Credential probes across every credential. Same shape as
 * `CLAIM_GLOBAL_POLICY`: only failed verifications charge it, every call checks
 * it without writing, and no success resets it.
 */
export const CREDENTIAL_GLOBAL_POLICY: RateLimitPolicy = {
  maxAttempts: 300,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 30 * 1000,
  maxLockoutMs: 5 * 60 * 1000,
};

/** Anonymous contact form: each accepted call schedules an outbound webhook. */
export const CONTACT_POLICY: RateLimitPolicy = {
  maxAttempts: 3,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 5 * 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/**
 * Contact-form flood across many addresses. A short ceiling for the same
 * denial-of-service reason as the other global buckets: tripping it silences
 * the public contact form, so it must recover in minutes.
 */
export const CONTACT_GLOBAL_POLICY: RateLimitPolicy = {
  maxAttempts: 60,
  windowMs: 10 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 10 * 60 * 1000,
};

/** Server-minted browser sessions: the alarm level for `noteAttempt`, never a
 * gate. Past this rate the mint logs; it never refuses a browser. */
export const SESSION_MINT_POLICY: RateLimitPolicy = {
  maxAttempts: 20,
  windowMs: 60 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/**
 * Registry download counting: one counted download per source address, plugin
 * version and day. The download itself is never refused; only the counter
 * that ranks the catalog is bounded.
 */
export const DOWNLOAD_COUNT_POLICY: RateLimitPolicy = {
  maxAttempts: 1,
  windowMs: 24 * 60 * 60 * 1000,
  baseLockoutMs: 1,
  maxLockoutMs: 1,
};

/**
 * The outcome of a limiter check. A refusal carries the remaining lockout so a
 * caller can render an honest "try again in N" rather than a generic failure —
 * a lockout an operator cannot distinguish from a broken backend is the same
 * indistinguishable-failure defect this module exists to remove.
 *
 * A verdict, not a throw: a Convex mutation that throws is rolled back, which
 * would discard the very attempt count and lockout being recorded. A mutation
 * caller returns a refusal value so its transaction commits; an action caller
 * may throw {@link RateLimited} once the recording mutation has committed.
 */
export type RateVerdict = { ok: true } | { ok: false; retryAfterMs: number };

const ALLOWED: RateVerdict = { ok: true };

function refused(retryAfterMs: number): RateVerdict {
  return { ok: false, retryAfterMs: Math.max(retryAfterMs, 1) };
}

/** The refusal value a mutation returns to its client when a bucket refuses. */
export function rateLimitedResult(retryAfterMs: number) {
  return { error: "rate_limited" as const, retryAfterMs };
}

/** Thrown by an action (never inside a mutation) for a refused verdict. */
export class RateLimited extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs: number) {
    super(`rate_limited: retry in ${Math.ceil(retryAfterMs / 1000)}s`);
    this.name = "RateLimited";
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Lockout applied after `overflow` attempts beyond the window allowance.
 * `overflow` is 1 for the first attempt past `maxAttempts`.
 *
 * Pure, and exported, because the doubling is the part worth pinning in a test:
 * an off-by-one here is either a lockout that never grows or one that overflows
 * to Infinity, and both read as "the limiter is on".
 */
export function lockoutDurationMs(
  overflow: number,
  policy: RateLimitPolicy,
): number {
  if (overflow <= 0) return 0;
  // Cap the shift before it is applied: 1 << 31 is negative in JS, and a
  // Math.min after the fact would happily return that negative number.
  const steps = Math.min(overflow - 1, 30);
  return Math.min(policy.baseLockoutMs * 2 ** steps, policy.maxLockoutMs);
}

async function loadBucket(ctx: MutationCtx, key: string) {
  return await ctx.db
    .query("cmd_authAttempts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
}

/**
 * Refuse when the bucket is locked; otherwise record one attempt against it,
 * refusing when that attempt overflows the allowance.
 *
 * Call this BEFORE doing the work, on every attempt, and call `clearAttempts`
 * only once the attempt is known to have succeeded. Recording after the fact
 * would mean a failure never gets counted, which is exactly the attempt worth
 * counting. On a refusal the caller must return (not throw), so the recorded
 * attempt and lockout commit.
 */
export async function chargeAttempt(
  ctx: MutationCtx,
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<RateVerdict> {
  const row = await loadBucket(ctx, key);

  if (!row) {
    await ctx.db.insert("cmd_authAttempts", {
      key,
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: 0,
    });
    return ALLOWED;
  }

  if (row.lockedUntil > now) {
    return refused(row.lockedUntil - now);
  }

  // Window elapsed with the lockout (if any) already served: start clean.
  if (now - row.firstAttemptAt > policy.windowMs) {
    await ctx.db.patch(row._id, {
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: 0,
    });
    return ALLOWED;
  }

  const attempts = row.attempts + 1;
  const overflow = attempts - policy.maxAttempts;
  const lockedUntil =
    overflow > 0 ? now + lockoutDurationMs(overflow, policy) : 0;

  await ctx.db.patch(row._id, {
    attempts,
    lastAttemptAt: now,
    lockedUntil,
  });

  return lockedUntil > now ? refused(lockedUntil - now) : ALLOWED;
}

/**
 * Refuse when a bucket is locked or already at its allowance, without
 * recording anything.
 *
 * For a shared bucket that only FAILED attempts charge: this check runs on
 * every call and `chargeAttempt` runs only on a failure, so healthy traffic
 * never writes the shared row (no hot document serialising every caller) and a
 * success by one caller never resets a bound that protects everyone.
 */
export async function checkBucket(
  ctx: MutationCtx,
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<RateVerdict> {
  const row = await loadBucket(ctx, key);
  if (!row) return ALLOWED;
  if (row.lockedUntil > now) {
    return refused(row.lockedUntil - now);
  }
  const windowEnd = row.firstAttemptAt + policy.windowMs;
  if (now <= windowEnd && row.attempts >= policy.maxAttempts) {
    return refused(windowEnd - now);
  }
  return ALLOWED;
}

/**
 * Count one event toward a bucket that never refuses the caller, and log when
 * the count first passes the allowance inside a window.
 *
 * For an anonymous action with no caller identity to bucket by: a blocking
 * global limit there is a lever any one caller can pull to lock every
 * legitimate user out, so the global view is an alarm, not a gate.
 */
export async function noteAttempt(
  ctx: MutationCtx,
  key: string,
  policy: RateLimitPolicy,
  now: number = Date.now(),
): Promise<void> {
  const row = await loadBucket(ctx, key);
  if (!row) {
    await ctx.db.insert("cmd_authAttempts", {
      key,
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: 0,
    });
    return;
  }
  if (now - row.firstAttemptAt > policy.windowMs) {
    await ctx.db.patch(row._id, {
      attempts: 1,
      firstAttemptAt: now,
      lastAttemptAt: now,
      lockedUntil: 0,
    });
    return;
  }
  const attempts = row.attempts + 1;
  await ctx.db.patch(row._id, { attempts, lastAttemptAt: now });
  if (attempts === policy.maxAttempts + 1) {
    console.warn(
      `rate alarm: ${key} passed ${policy.maxAttempts} events in ${Math.round(policy.windowMs / 60000)} min`,
    );
  }
}

/** Drop a bucket after a legitimate success, so a real operator never ladders. */
export async function clearAttempts(
  ctx: MutationCtx,
  key: string,
): Promise<void> {
  const row = await loadBucket(ctx, key);
  if (row) await ctx.db.delete(row._id);
}

/** SHA-256 hex. Used to store bearer secrets as verifiers, never in plaintext. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Salted digest of the request's client address, for use as a rate-limit
 * bucket key only.
 *
 * Hashed rather than stored raw: the bucket table would otherwise be a log of
 * every address that ever touched the endpoint, which is personal data this
 * system has no reason to retain. Salted with the relay secret so the digest
 * is not a rainbow-table lookup of the IPv4 space; falls back to an unsalted
 * digest when unconfigured, which is still fine for bucketing.
 *
 * The address is `CF-Connecting-IP` when the edge set it (the edge overwrites
 * any client-supplied value), else the LAST `x-forwarded-for` hop, which the
 * nearest proxy appended. The FIRST hop is whatever the client sent, so keying
 * on it hands every request a fresh bucket. A request with neither header
 * buckets into one shared "unknown" pool rather than escaping the limit.
 */
export async function sourceBucketKey(request: Request): Promise<string> {
  const edge = request.headers.get("cf-connecting-ip")?.trim();
  const hops = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((hop) => hop.trim())
    .filter(Boolean);
  const source = edge || hops[hops.length - 1] || "unknown";
  const salt = process.env.MQTT_AUTH_RELAY_SECRET ?? "";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${source}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 256 bits from the CSPRNG, URL-safe base64 without padding. */
export function mintSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
