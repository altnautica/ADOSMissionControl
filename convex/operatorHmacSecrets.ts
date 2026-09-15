/**
 * @module operatorHmacSecrets
 * @description Per-operator HMAC secret used by the cloud issuer
 * to sign short-lived capability tokens for the GCS to agent plugin
 * RPC bridge.
 *
 * Secrets rotate every 30 days. The previous secret is retained in
 * `previousSecretBase64` so tokens minted just before a rotation
 * stay valid until they expire (TTL bounded by the capability-token
 * action; see `cmdPluginCapabilityTokens.mintToken`).
 *
 * The root secret never leaves the backend. `getMyVerificationKey`
 * hands the operator's GCS a key derived from it for one (plugin
 * install, device) pair, so the browser can verify that pair's
 * tokens locally in offline / LAN-direct mode without holding the
 * key that mints for the whole account. Plugin code never reads any
 * of it — only the cloud issuer signs, and only the GCS bridge and
 * the agent verify.
 *
 * Crypto: uses Web Crypto (`crypto.getRandomValues`), no "use node"
 * directive needed.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { deriveCapabilityTokenKey } from "./lib/capabilityTokenKeys";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

/** 30 days; matches the rotation cadence in the spec. */
const ROTATION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;
/** 32 random bytes = 256-bit HMAC-SHA256 key. */
const SECRET_BYTE_LENGTH = 32;

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────

function generateSecretBase64(): string {
  const bytes = new Uint8Array(SECRET_BYTE_LENGTH);
  crypto.getRandomValues(bytes);
  // btoa handles binary strings; build one byte at a time.
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// ──────────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────────

/**
 * Return the current HMAC secret for `userId`, minting a fresh one
 * on first use and rotating after `ROTATION_PERIOD_MS` has elapsed
 * since the last rotation. Always returns the secret as a
 * base64-encoded string.
 *
 * This is the only entry point the capability-token issuer uses; it
 * is an action because rotation writes to the table and needs to run
 * outside the read-only query path.
 */
export const getOrCreateCurrent = internalAction({
  args: { userId: v.string() },
  handler: async (ctx, { userId }): Promise<string> => {
    const existing = await ctx.runQuery(
      internal.operatorHmacSecrets.getCurrentInternal,
      { userId },
    );
    if (existing && Date.now() - existing.rotatedAt < ROTATION_PERIOD_MS) {
      return existing.secretBase64;
    }
    const newSecret = generateSecretBase64();
    await ctx.runMutation(internal.operatorHmacSecrets.rotate, {
      userId,
      newSecretBase64: newSecret,
      previousSecretBase64: existing?.secretBase64,
    });
    return newSecret;
  },
});

// ──────────────────────────────────────────────────────────────
// Internal queries / mutations
// ──────────────────────────────────────────────────────────────

/** Read the current row for `userId`. Internal because the root
 * secret is never returned to a caller: the only public read is
 * `getMyVerificationKey`, which returns a scope-derived key. */
export const getCurrentInternal = internalQuery({
  args: { userId: v.string() },
  handler: async (
    ctx,
    { userId },
  ): Promise<Doc<"operator_hmac_secrets"> | null> => {
    return await ctx.db
      .query("operator_hmac_secrets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
  },
});

/** Insert or rotate the secret row for `userId`. */
export const rotate = internalMutation({
  args: {
    userId: v.string(),
    newSecretBase64: v.string(),
    previousSecretBase64: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("operator_hmac_secrets")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    const patch = {
      userId: args.userId,
      secretBase64: args.newSecretBase64,
      rotatedAt: Date.now(),
      previousSecretBase64: args.previousSecretBase64,
    };
    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return existing._id;
    }
    return await ctx.db.insert("operator_hmac_secrets", patch);
  },
});

// ──────────────────────────────────────────────────────────────
// Public queries
// ──────────────────────────────────────────────────────────────

/**
 * Return the token verification key for one (plugin install, device)
 * pair, plus the previous-rotation key when one exists, so the GCS
 * bridge can verify that iframe's `cloud:` tokens locally — including
 * in offline / LAN-direct mode — across a rotation overlap.
 *
 * Both values are DERIVED (`lib/capabilityTokenKeys`), never the root
 * minting secret. This query used to return `secretBase64` straight
 * off the row: the key that signs every capability token for the
 * account, handed to the browser on page load. Any XSS or stolen
 * session could then forge a token for any install and any drone the
 * operator owned, without touching Convex again — and rotation did not
 * help, because the previous secret came back too. A derived key
 * forges only for the pair the caller already proved it owns and
 * already mints for, which is no authority gain at all.
 *
 * Returns null — never throws — for an unauthenticated caller, an
 * install the caller does not own, an install not bound to `deviceId`,
 * or an operator with no secret row yet, so a render-time read is safe.
 */
export const getMyVerificationKey = query({
  args: {
    pluginInstallId: v.id("cmd_pluginInstalls"),
    deviceId: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    secretBase64: string;
    previousSecretBase64?: string;
    rotatedAt: number;
  } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    // Ownership + scope binding, mirroring `mintToken`: the install must
    // belong to the caller and must target the device whose key is asked
    // for. Without the second check an operator could pull the key for a
    // (install, drone) pair they cannot mint for.
    const install = await ctx.db.get(args.pluginInstallId);
    if (!install || install.userId !== userId) return null;
    if (install.droneId !== args.deviceId) return null;

    const row = await ctx.db
      .query("operator_hmac_secrets")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!row) return null;

    return {
      secretBase64: await deriveCapabilityTokenKey(
        row.secretBase64,
        args.pluginInstallId,
        args.deviceId,
      ),
      previousSecretBase64: row.previousSecretBase64
        ? await deriveCapabilityTokenKey(
            row.previousSecretBase64,
            args.pluginInstallId,
            args.deviceId,
          )
        : undefined,
      rotatedAt: row.rotatedAt,
    };
  },
});
