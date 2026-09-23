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
 * The broker learns a principal when the host-side password/ACL generator
 * reads it through `cmdPairing.listMqttAuthEntries`, which emits every live,
 * unrevoked grant. That runs on its own cadence, so the client treats a grant
 * it has not exercised as unproven rather than as authority.
 *
 * Grants are per browser session, not per operator: a tab renews by naming the
 * grant it replaces, so two tabs (or a laptop and a tablet) each keep their
 * own. A small ceiling on live grants bounds the broker's principal list.
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

/** Live grants one operator may hold at once (one per open browser session). */
const MAX_LIVE_GRANTS_PER_USER = 4;

/** Expired rows are kept this long for review, then swept. */
const GRANT_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Rows deleted per sweep call; a full batch reschedules the sweep. */
const GRANT_PRUNE_BATCH = 256;

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
  // The principal this browser session held before, if any. Renewal replaces
  // it; nothing else of the operator's is touched.
  args: { replaces: v.optional(v.string()) },
  handler: async (ctx, { replaces }): Promise<GrantMintResult> => {
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
      replaces,
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
    replaces: v.optional(v.string()),
  },
  handler: async (ctx, { replaces, ...grant }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_user", (q) => q.eq("userId", grant.userId))
      .collect();
    // The grant this session replaces dies now rather than at its expiry.
    // Another session's grant is left alone.
    const live = rows
      .filter((row) => !row.revokedAt && row.expiresAt > now)
      .sort((a, b) => a.createdAt - b.createdAt);
    const survivors = [];
    for (const row of live) {
      if (row.principal === replaces) {
        await ctx.db.patch(row._id, { revokedAt: now });
      } else {
        survivors.push(row);
      }
    }
    // Bound the broker's principal list: past the ceiling the oldest go.
    const excess = survivors.length - (MAX_LIVE_GRANTS_PER_USER - 1);
    for (const row of survivors.slice(0, Math.max(0, excess))) {
      await ctx.db.patch(row._id, { revokedAt: now });
    }
    await ctx.db.insert("cmd_mqttControlGrants", { ...grant, createdAt: now });
  },
});

/**
 * The metadata of one of the caller's grants, by principal — never the
 * verifier, never the secret. The browser holds the secret from its own mint
 * response; this tells it whether that grant is still live (not revoked, not
 * expired) and whether the broker has accepted a write under it. Null when the
 * grant is gone.
 */
export const myCurrent = query({
  args: { principal: v.string() },
  handler: async (ctx, { principal }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_principal", (q) => q.eq("principal", principal))
      .first();
    if (!row || row.userId !== userId || row.revokedAt) return null;
    if (row.expiresAt <= Date.now()) return null;
    return {
      principal: row.principal,
      deviceIds: row.deviceIds,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      lastConfirmedAt: row.lastConfirmedAt ?? null,
    };
  },
});

/** Revoke every live grant the caller holds (sign-out). Instant here; the
 * broker follows on its next password/ACL regeneration, and each grant's expiry
 * bounds the gap. */
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

/**
 * Cron job: delete grant rows expired past the review window. Without it every
 * mint (one per session per hour) stays forever. Ranges `by_expiresAt` so the
 * cost tracks what is deleted, and reschedules while a full batch went.
 */
export const pruneExpiredGrants = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - GRANT_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_mqttControlGrants")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", cutoff))
      .take(GRANT_PRUNE_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    if (stale.length === GRANT_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdMqttControlGrants.pruneExpiredGrants, {});
    }
    return { deleted: stale.length };
  },
});
