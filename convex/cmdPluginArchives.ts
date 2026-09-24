/**
 * @module cmdPluginArchives
 * @description Uploaded `.adosplug` archive registry. One row per
 * (user, sha256) so a fleet-wide install does not re-upload the same
 * payload. Backs the per-drone plugin install flow:
 *
 *   1. GCS asks for a one-time upload URL via `generateUploadUrl`.
 *   2. Client uploads the archive blob to that URL (Convex storage).
 *   3. Client calls `verifyArchive` (Node-runtime action defined in
 *      `cmdPluginArchivesVerify.ts`). The server fetches storage
 *      metadata, compares the authoritative SHA-256 against the
 *      client claim, streams the blob and re-extracts `manifest.yaml`
 *      to verify its content hash, rejects any prior claim on the
 *      same `storageId` by a different user, and only then inserts
 *      the registry row via `_insertArchive`.
 *   4. The install-jobs module reads the row to mint a short-lived
 *      signed download URL the agent fetches over the cloud relay.
 *
 * The agent never touches this module directly. The signed download
 * URL is embedded in a `cmd_droneCommands` row owned by the operator,
 * so authentication on the download path is bounded by the URL TTL
 * and the agent's existing pairing-key trust.
 *
 * Integrity is enforced server-side: the row's `sha256` is the value
 * the storage layer computed at upload time (not the client claim),
 * and `manifestHash` is the SHA-256 of the bytes the server extracted
 * from the archive (not a client value).
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "./_generated/dataModel";

// ──────────────────────────────────────────────────────────────
// Validators
// ──────────────────────────────────────────────────────────────

const declaredPermissionValidator = v.object({
  id: v.string(),
  required: v.boolean(),
});

// ──────────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────────

/**
 * Returns a one-time upload URL the client uses to PUT the
 * `.adosplug` archive blob into Convex storage. Caller is expected
 * to follow up with `verifyArchive` (in `cmdPluginArchivesVerify.ts`)
 * once the upload completes.
 */
export const generateUploadUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    return await ctx.storage.generateUploadUrl();
  },
});

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

/**
 * Internal insert. Called only by `verifyArchive` after every
 * integrity gate has passed. Carries server-computed hashes so the
 * row's contents are not derived from any client value.
 */
export const _insertArchive = internalMutation({
  args: {
    userId: v.string(),
    storageId: v.id("_storage"),
    fileName: v.string(),
    sizeBytes: v.number(),
    sha256: v.string(),
    pluginId: v.string(),
    version: v.string(),
    manifestHash: v.string(),
    declaredPermissions: v.array(declaredPermissionValidator),
    signerId: v.optional(v.string()),
    signatureB64: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"plugin_archives">> => {
    // Dedupe: if the same user already uploaded this exact blob
    // (same sha256), reuse the existing row.
    const existing = await ctx.db
      .query("plugin_archives")
      .withIndex("by_sha256", (q) => q.eq("sha256", args.sha256))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
    if (existing) {
      // Drop the redundant blob we just verified to keep storage tidy.
      await ctx.storage.delete(args.storageId);
      return existing._id;
    }

    return await ctx.db.insert("plugin_archives", {
      userId: args.userId,
      storageId: args.storageId,
      fileName: args.fileName,
      sizeBytes: args.sizeBytes,
      sha256: args.sha256,
      pluginId: args.pluginId,
      version: args.version,
      manifestHash: args.manifestHash,
      declaredPermissions: args.declaredPermissions,
      signerId: args.signerId,
      signatureB64: args.signatureB64,
      uploadedAt: Date.now(),
    });
  },
});

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

/** Read one archive row by id, scoped to the authenticated user. */
export const getArchive = query({
  args: { id: v.id("plugin_archives") },
  handler: async (ctx, { id }): Promise<Doc<"plugin_archives"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) return null;
    return row;
  },
});

/**
 * Internal read for use by actions that have already proven the
 * caller is authorized through some other path (e.g. install-jobs
 * mutation already validated ownership of the drone + archive).
 */
export const getArchiveInternal = internalQuery({
  args: { id: v.id("plugin_archives") },
  handler: async (ctx, { id }): Promise<Doc<"plugin_archives"> | null> => {
    return await ctx.db.get(id);
  },
});

/**
 * Internal lookup for the verify action's ownership guard. Returns
 * the first row that has already claimed the given storageId,
 * regardless of owner. Callers compare `userId` to decide whether to
 * reject the new claim.
 */
export const _findByStorageId = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (
    ctx,
    { storageId },
  ): Promise<Doc<"plugin_archives"> | null> => {
    return await ctx.db
      .query("plugin_archives")
      .withIndex("by_storageId", (q) => q.eq("storageId", storageId))
      .first();
  },
});

/** List every archive uploaded by the authenticated user, newest first. */
export const listMine = query({
  args: {},
  handler: async (ctx): Promise<Doc<"plugin_archives">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("plugin_archives")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.uploadedAt - a.uploadedAt);
  },
});
