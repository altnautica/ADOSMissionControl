/**
 * @module cmdSigningKeys
 * @description Read and remove for MAVLink v2 signing-key rows.
 *
 * Signing keys live in the browser (IndexedDB), never in Convex; there is no
 * upload path. Rows written by an earlier cloud-sync surface can still exist,
 * so an operator can see that one is present (metadata only) and remove it.
 *
 * **Read discipline:** the per-drone read returns METADATA ONLY. `keyHex`
 * authenticates MAVLink command frames to the aircraft and never leaves the
 * backend.
 *
 * **Log discipline:** NEVER log `keyHex`. Log `keyId` (the 8-char
 * sha256 fingerprint) and `droneId` only.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { getAuthUserId } from "@convex-dev/auth/server";

/** Everything about a stored key except the key. */
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

/** Whether this drone has a stored key row, and its metadata if so. */
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

/** Remove the caller's stored key row for one drone. */
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
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});
