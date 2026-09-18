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
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
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

/**
 * Mint a short-lived signed download URL for the archive blob. The
 * URL is embedded in a `cmd_droneCommands` row by `createJob` and
 * the agent fetches it once. TTL is enforced by the install-jobs
 * mutation (5 minutes by default); this action only returns the
 * URL plus a hint at the resolved expiry.
 *
 * INTERNAL. It performs no auth check of its own, so it must never be
 * callable from a client: it was exported as a public `action` that took an
 * `archiveId` and returned `ctx.storage.getUrl(...)` for it with no
 * `getAuthUserId` and no ownership comparison, so any unauthenticated caller
 * could mint a signed download URL for ANY uploaded plugin archive.
 *
 * The doc comment claimed `cmdPluginInstallJobs.createJob` authorised the
 * caller, but `createJob` calls `ctx.storage.getUrl` inline and never invokes
 * this — so nothing upstream was gating it. A caller outside an
 * already-authorised internal flow must do its own auth.
 */
export const getSignedDownloadUrl = internalAction({
  args: { archiveId: v.id("plugin_archives") },
  handler: async (
    ctx,
    { archiveId },
  ): Promise<{ url: string; expiresAt: number }> => {
    const archive = await ctx.runQuery(
      internal.cmdPluginArchives.getArchiveInternal,
      { id: archiveId },
    );
    if (!archive) throw new Error("Archive not found");
    const url = await ctx.storage.getUrl(archive.storageId);
    if (!url) throw new Error("Archive blob missing in storage");
    // Convex storage URLs are valid for ~1h. We do not control that
    // window directly; the install-jobs mutation bounds the surface
    // by writing a 5-minute deadline into the command row.
    const expiresAt = Date.now() + 5 * 60 * 1000;
    return { url, expiresAt };
  },
});

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

/**
 * Legacy public mutation retained for OSS callers that still target
 * the pre-verify shape. Now refuses every call: integrity is enforced
 * by `verifyArchive` (action, defined in `cmdPluginArchivesVerify.ts`).
 * Returning a hard error here makes the behavior visible in client
 * logs instead of silently writing forged rows.
 */
export const recordArchive = mutation({
  args: {
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
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    throw new Error(
      "recordArchive is deprecated. Use verifyArchive instead so the server can validate the upload's SHA-256 and manifest hash.",
    );
  },
});

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
    // (same sha256), reuse the existing row and bump refCount.
    const existing = await ctx.db
      .query("plugin_archives")
      .withIndex("by_sha256", (q) => q.eq("sha256", args.sha256))
      .filter((q) => q.eq(q.field("userId"), args.userId))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { refCount: existing.refCount + 1 });
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
      refCount: 0,
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
      .filter((q) => q.eq(q.field("storageId"), storageId))
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
