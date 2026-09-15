/**
 * @module cmdSigningKeys
 * @description Opt-in cloud sync for MAVLink v2 signing keys.
 *
 * Rows are scoped to the authenticated user via Convex auth. Every
 * function checks `getAuthUserId(ctx)` and rejects if no identity is
 * present. New plaintext uploads are disabled until client-side
 * encrypted storage is available.
 *
 * **Read discipline:** the list and per-drone reads return METADATA
 * ONLY. `keyHex` authenticates MAVLink command frames to the aircraft,
 * so a read that ships it to the browser on every Signing-panel render
 * hands forged-command capability to any XSS, any extension, and any
 * devtools screenshot in a support thread. Key material leaves the
 * backend through exactly one door, `exportKey`, which is an explicit
 * operator action and writes an audit row in the same transaction.
 *
 * **Log discipline:** NEVER log `keyHex`. Log `keyId` (the 8-char
 * sha256 fingerprint) and `droneId` only. Any `console.log` with
 * `keyHex` in scope is a bug.
 *
 * **Rate limiting:** not implemented in v1. The GCS has no automatic
 * retry loop that could spam these endpoints: every call path is
 * driven by an explicit operator click. A future v1.1 should add a
 * sliding-window limiter keyed by userId if these mutations become
 * reachable by third-party clients or background sync cadences.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

function cloudSigningKeyUploadsEnabled(): boolean {
  return false;
}

// ──────────────────────────────────────────────────────────────
// Projection
// ──────────────────────────────────────────────────────────────

/** Everything about a synced key except the key. */
interface SigningKeyMetadata {
  _id: Id<"cmd_signingKeys">;
  _creationTime: number;
  userId: string;
  droneId: string;
  keyId: string;
  linkIdOwner: number;
  linkIdsInUse: number[];
  enrolledAt: string;
  updatedAt: number;
}

/** Drop `keyHex`. Written as an explicit field list, not a rest-spread
 *  delete, so a column added to the table is omitted by default rather
 *  than published by default. */
function toMetadata(row: Doc<"cmd_signingKeys">): SigningKeyMetadata {
  return {
    _id: row._id,
    _creationTime: row._creationTime,
    userId: row.userId,
    droneId: row.droneId,
    keyId: row.keyId,
    linkIdOwner: row.linkIdOwner,
    linkIdsInUse: row.linkIdsInUse,
    enrolledAt: row.enrolledAt,
    updatedAt: row.updatedAt,
  };
}

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

/** List every signing key the authenticated user has cloud-synced.
 *  Metadata only — see the read discipline note above. */
export const listMine = query({
  args: {},
  handler: async (ctx): Promise<SigningKeyMetadata[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map(toMetadata);
  },
});

/** Whether this drone has a cloud-synced key, and its metadata if so.
 *  Metadata only; `keyHex` comes from `exportKey`. */
export const getForDrone = query({
  args: { droneId: v.string() },
  handler: async (ctx, { droneId }): Promise<SigningKeyMetadata | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();
    return row ? toMetadata(row) : null;
  },
});

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

/**
 * Upsert a signing key record for the current user and drone.
 *
 * Caller supplies `keyHex` (raw 64-char hex), `keyId` (fingerprint for
 * UI), and `linkIdOwner`. The row's `linkIdsInUse` tracks every link
 * id claimed so multi-device signing avoids collisions.
 *
 * No rate limit in v1; a naive caller hitting this in a loop is a bug
 * in the GCS, not an abuse vector. v1.1 adds per-user throttling.
 */
export const store = mutation({
  args: {
    droneId: v.string(),
    keyHex: v.string(),
    keyId: v.string(),
    linkIdOwner: v.number(),
    enrolledAt: v.string(),
  },
  handler: async (ctx, { droneId, keyHex, keyId, linkIdOwner, enrolledAt }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    if (!cloudSigningKeyUploadsEnabled()) {
      throw new Error("cloud signing-key sync is disabled");
    }

    // Basic shape validation. Defensive against malformed GCS payloads.
    if (keyHex.length !== 64 || !/^[0-9a-fA-F]+$/.test(keyHex)) {
      throw new Error("keyHex must be 64 hex chars");
    }
    if (keyId.length !== 8) {
      throw new Error("keyId must be 8 chars");
    }
    if (linkIdOwner < 1 || linkIdOwner > 254 || !Number.isInteger(linkIdOwner)) {
      throw new Error("linkIdOwner must be an integer in [1, 254]");
    }

    const existing = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();

    const now = Date.now();

    if (existing) {
      // Defensive: ensure the row actually belongs to this user. The
      // index already guarantees this, but belt-and-suspenders against
      // a bug in future index changes.
      if (existing.userId !== userId) {
        throw new Error("ownership mismatch");
      }
      const linkIdsInUse = Array.from(
        new Set([...existing.linkIdsInUse, linkIdOwner]),
      );
      await ctx.db.patch(existing._id, {
        keyHex,
        keyId,
        linkIdOwner,
        linkIdsInUse,
        enrolledAt,
        updatedAt: now,
      });
      return { _id: existing._id, keyId };
    }

    const id = await ctx.db.insert("cmd_signingKeys", {
      userId,
      droneId,
      keyHex,
      keyId,
      linkIdOwner,
      linkIdsInUse: [linkIdOwner],
      enrolledAt,
      updatedAt: now,
    });
    return { _id: id, keyId };
  },
});

/** Remove a signing key record. */
export const removeKey = mutation({
  args: { droneId: v.string() },
  handler: async (ctx, { droneId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const existing = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();
    if (!existing) return { removed: false };
    if (existing.userId !== userId) throw new Error("ownership mismatch");
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

/**
 * Claim the lowest-unused link_id in [1, 254] for this drone, reserving
 * it in the row's `linkIdsInUse` array. If no row exists yet, returns
 * linkId = 1 and the caller should call `store` with that id.
 *
 * Replaces the prior browser-fingerprint allocator when cloud sync is
 * enabled: avoids collisions when multiple devices enroll for the same
 * drone.
 */
export const allocateLinkId = mutation({
  args: { droneId: v.string() },
  handler: async (ctx, { droneId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const existing = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();

    const inUse = new Set(existing?.linkIdsInUse ?? []);
    // Walk the [1, 254] range and return the first free id. Reserves 0
    // and 255.
    for (let id = 1; id <= 254; id++) {
      if (!inUse.has(id)) {
        if (existing) {
          await ctx.db.patch(existing._id, {
            linkIdsInUse: [...existing.linkIdsInUse, id],
            updatedAt: Date.now(),
          });
        }
        return { linkId: id };
      }
    }
    throw new Error("no available link_id; all 254 slots in use");
  },
});

/**
 * Release a link id so another device can claim it later. Called on
 * revoke or when a browser stops using cloud sync for this drone.
 */
export const releaseLinkId = mutation({
  args: { droneId: v.string(), linkId: v.number() },
  handler: async (ctx, { droneId, linkId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    const existing = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();
    if (!existing) return { released: false };
    if (existing.userId !== userId) throw new Error("ownership mismatch");
    const remaining = existing.linkIdsInUse.filter((id) => id !== linkId);
    await ctx.db.patch(existing._id, {
      linkIdsInUse: remaining,
      updatedAt: Date.now(),
    });
    return { released: true };
  },
});

/**
 * The one door key material leaves by.
 *
 * A mutation rather than a query or an action, deliberately: the export
 * and its audit row land in the same transaction, so an export cannot
 * succeed and go unlogged. `deviceFingerprint` is the same short opaque
 * hash `cmdSigningEvents.append` takes — never a userId, never PII.
 *
 * The caller must already own the row (the `by_user_drone` index scopes
 * the lookup to the authenticated user). Returns null when this drone
 * has no synced key, and writes nothing in that case.
 */
export const exportKey = mutation({
  args: { droneId: v.string(), deviceFingerprint: v.string() },
  handler: async (
    ctx,
    { droneId, deviceFingerprint },
  ): Promise<{ keyHex: string; keyId: string } | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("unauthenticated");
    if (deviceFingerprint.length < 4 || deviceFingerprint.length > 64) {
      throw new Error("deviceFingerprint must be 4-64 chars");
    }

    const existing = await ctx.db
      .query("cmd_signingKeys")
      .withIndex("by_user_drone", (q) =>
        q.eq("userId", userId).eq("droneId", droneId),
      )
      .first();
    if (!existing) return null;
    if (existing.userId !== userId) throw new Error("ownership mismatch");

    await ctx.db.insert("cmd_signingEvents", {
      userId,
      droneId,
      eventType: "export",
      keyIdNew: existing.keyId,
      deviceFingerprint,
      createdAt: Date.now(),
    });

    return { keyHex: existing.keyHex, keyId: existing.keyId };
  },
});
