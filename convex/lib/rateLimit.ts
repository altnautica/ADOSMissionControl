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
 * Backstop against a distributed spray across many browser sessions. Set well
 * above what a busy fleet produces: a successful claim clears the bucket, so a
 * room full of operators pairing correctly never approaches it.
 *
 * A GLOBAL bucket is itself a denial-of-service lever — an attacker who trips
 * it locks out every legitimate anonymous pairing too — so the ceiling is
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
 * Credential probes across every credential. Same denial-of-service reasoning
 * as `CLAIM_GLOBAL_POLICY`, and a looser allowance because a healthy MCP fleet
 * verifies constantly: every success clears this bucket, so only an
 * uninterrupted run of failures accumulates.
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

/** Server-minted browser sessions. Bounds table growth from an anonymous mint. */
export const SESSION_MINT_POLICY: RateLimitPolicy = {
  maxAttempts: 20,
  windowMs: 60 * 60 * 1000,
  baseLockoutMs: 60 * 1000,
  maxLockoutMs: 60 * 60 * 1000,
};

/**
 * Thrown when a bucket is locked. Carries the remaining lockout so a caller can
 * render an honest "try again in N" rather than a generic failure — a lockout
 * an operator cannot distinguish from a broken backend is the same
 * indistinguishable-failure defect this module exists to remove.
 */
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
 * Refuse when the bucket is locked; otherwise record one attempt against it.
 *
 * Call this BEFORE doing the work, on every attempt, and call `clearAttempts`
 * only once the attempt is known to have succeeded. Recording after the fact
 * would mean a failure that throws never gets counted, which is exactly the
 * attempt worth counting.
 */
export async function consumeAttempt(
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

  if (row.lockedUntil > now) {
    throw new RateLimited(row.lockedUntil - now);
  }

  // Window elapsed with the lockout (if any) already served: start clean.
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
  const overflow = attempts - policy.maxAttempts;
  const lockedUntil =
    overflow > 0 ? now + lockoutDurationMs(overflow, policy) : 0;

  await ctx.db.patch(row._id, {
    attempts,
    lastAttemptAt: now,
    lockedUntil,
  });

  if (lockedUntil > now) {
    throw new RateLimited(lockedUntil - now);
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

/** 256 bits from the CSPRNG, URL-safe base64 without padding. */
export function mintSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
