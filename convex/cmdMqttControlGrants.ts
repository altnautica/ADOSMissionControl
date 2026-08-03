/**
 * @module cmdMqttControlGrants
 * @description Issues the per-operator broker credential that lets a cloud
 * relay session actually command a drone.
 *
 * The problem this solves: the browser's broker credential is shared and
 * read-only, so a relay session can subscribe to a drone's telemetry and cannot
 * publish anything to it. Flight commands and video signaling offers are
 * publishes, so over the relay they are accepted by the client, discarded by the
 * broker, and reported nowhere. Widening the shared credential would fix the
 * symptom by giving every browser session write access to every drone in every
 * fleet, which is not a trade worth making.
 *
 * A grant is instead scoped, expiring and revocable:
 *
 *   scoped      the device list is computed here from the caller's own drones.
 *               The caller does not ask for a scope, it is told one, so a
 *               hand-made call cannot widen itself.
 *   expiring    short TTL, renewed while the tab is in use. A leaked grant
 *               stops working on its own.
 *   revocable   `revokedAt` is a row flag, so a grant dies the moment the
 *               operator says so, without waiting for its expiry.
 *
 * Only the broker's verifier is stored, never the secret (see
 * `mosquittoPasswd`), matching the bar `cmdMcpTokens` sets. The plaintext is
 * returned exactly once, at mint.
 *
 * INERT: nothing consumes these rows yet. The broker learns about a principal
 * when the host-side password/ACL generator reads it, and that generator is not
 * wired to this table. Until it is, a minted grant is a row and nothing more —
 * which is why the client treats a grant it has not exercised as unproven
 * rather than as authority.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { buildPasswdEntry } from "./mosquittoPasswd";

/**
 * Grant lifetime. Deliberately short: the broker only learns that a grant was
 * revoked when the host-side generator next runs, so expiry — which the broker
 * enforces by itself once the entry is gone — is the bound that does not depend
 * on that cadence being healthy. Raising this trades directly against how long
 * a revoked or stolen grant keeps working.
 */
export const GRANT_TTL_MS = 60 * 60 * 1000;

/** URL-safe base64, no padding. */
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface GrantMintResult {
  /** Broker username. Opaque, carries no operator identity. */
  principal: string;
  /** The plaintext secret. Returned once, never stored or logged. */
  secret: string;
  /** Devices this grant authorises writes for. */
  deviceIds: string[];
  expiresAt: number;
}

/**
 * Mint a broker write grant for the authenticated operator, covering the drones
 * they own. Runs as an action for Web Crypto; the row is written through an
 * internal mutation so the secret never leaves this handler.
 */
export const mint = action({
  args: {},
  handler: async (ctx): Promise<GrantMintResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Scope is derived, never accepted from the caller.
    const deviceIds: string[] = await ctx.runQuery(
      internal.cmdMqttControlGrants.ownedDeviceIds,
      { userId },
    );
    if (deviceIds.length === 0) {
      // A grant covering nothing is not a useful credential, and minting one
      // would put a principal on the broker that can never be used. Refuse
      // rather than emit a credential whose scope is empty.
      throw new Error("No paired devices to grant control over");
    }

    const principal = `gcs-op-${b64url(crypto.getRandomValues(new Uint8Array(12)))}`;
    const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const passwdEntry = await buildPasswdEntry(principal, secret);
    const expiresAt = Date.now() + GRANT_TTL_MS;

    await ctx.runMutation(internal.cmdMqttControlGrants.insert, {
      userId,
      principal,
      passwdEntry,
      deviceIds,
      expiresAt,
    });

    return { principal, secret, deviceIds, expiresAt };
  },
});

/** Internal: the caller's own paired devices. The grant's scope, derived. */
export const ownedDeviceIds = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, { userId }) => {
    const drones = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
    return drones.map((d) => d.deviceId).filter((id) => id.length > 0);
  },
});

/** Internal: persist a minted grant's verifier + metadata. */
export const insert = internalMutation({
  args: {
    userId: v.string(),
    principal: v.string(),
    passwdEntry: v.string(),
    deviceIds: v.array(v.string()),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    // One live grant per operator: a tab that mints on every load would
    // otherwise grow the broker's principal list without bound, and every
    // superseded principal would stay valid until its own expiry.
    const existing = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const now = Date.now();
    for (const row of existing) {
      if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: now });
    }
    await ctx.db.insert("cmd_mqttControlGrants", { ...args, createdAt: now });
  },
});

/**
 * The caller's current grant metadata — never the verifier, never the secret.
 * The browser holds the secret from its own mint response; this is only so a
 * surface can say what is held and until when.
 */
export const myCurrent = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const rows = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1);
    const row = rows[0];
    if (!row || row.revokedAt) return null;
    return {
      principal: row.principal,
      deviceIds: row.deviceIds,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastConfirmedAt: row.lastConfirmedAt ?? null,
    };
  },
});

/** Revoke the caller's live grant. Instant here; the broker follows on its
 * next password/ACL regeneration, and the grant's expiry bounds the gap. */
export const revoke = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const rows = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const now = Date.now();
    let revoked = 0;
    for (const row of rows) {
      if (!row.revokedAt) {
        await ctx.db.patch(row._id, { revokedAt: now });
        revoked++;
      }
    }
    return { revoked };
  },
});

/**
 * Record that the holder proved the broker accepts its writes. Confirmation is
 * observed, not assumed: a grant that has been issued but never exercised is
 * not evidence the broker has seen it, because the host-side generator may not
 * have run yet.
 */
export const confirmWrite = mutation({
  args: { principal: v.string() },
  handler: async (ctx, { principal }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_principal", (q) => q.eq("principal", principal))
      .first();
    // Scoped to the owner so one operator cannot mark another's grant proven.
    if (!row || row.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(row._id, { lastConfirmedAt: Date.now() });
    return { ok: true };
  },
});
