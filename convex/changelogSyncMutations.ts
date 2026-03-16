import { internalQuery, internalMutation } from "./_generated/server";
import { v } from "convex/values";

export const getSyncState = internalQuery({
  args: { repo: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("changelog_sync_state")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .first();
  },
});

export const updateSyncState = internalMutation({
  args: {
    lastSyncedSha: v.string(),
    lastSyncedAt: v.number(),
    repo: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("changelog_sync_state")
      .withIndex("by_repo", (q) => q.eq("repo", args.repo))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSyncedSha: args.lastSyncedSha,
        lastSyncedAt: args.lastSyncedAt,
      });
    } else {
      await ctx.db.insert("changelog_sync_state", {
        lastSyncedSha: args.lastSyncedSha,
        lastSyncedAt: args.lastSyncedAt,
        repo: args.repo,
      });
    }
  },
});

export const getAdminProfile = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db
      .query("profiles")
      .collect();
    return profiles.find((p) => p.role === "admin") ?? null;
  },
});

/** Insert a single commit as its own changelog entry */
export const insertCommitEntry = internalMutation({
  args: {
    title: v.string(),
    body: v.string(),
    bodyHtml: v.string(),
    tags: v.array(v.string()),
    commitSha: v.string(),
    commitUrl: v.string(),
    commitDate: v.number(),
    authorId: v.id("profiles"),
    repo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Idempotency: skip if this commit already has an entry
    const existing = await ctx.db
      .query("community_changelog")
      .withIndex("by_commitSha", (q) => q.eq("commitSha", args.commitSha))
      .first();

    if (existing) {
      return existing._id;
    }

    // Version = short SHA (7 chars)
    const version = args.commitSha.substring(0, 7);

    // Resolve author name for denormalization
    const author = await ctx.db.get(args.authorId);
    const authorName = author?.fullName ?? "Unknown";

    return await ctx.db.insert("community_changelog", {
      version,
      title: args.title,
      body: args.body,
      bodyHtml: args.bodyHtml,
      publishedAt: args.commitDate,
      authorId: args.authorId,
      authorName,
      tags: args.tags,
      published: true,
      source: "auto",
      commitSha: args.commitSha,
      commitUrl: args.commitUrl,
      commitDate: args.commitDate,
      ...(args.repo ? { repo: args.repo } : {}),
    });
  },
});

/** One-time backfill: populate authorName on existing entries missing it */
export const backfillAuthorNames = internalMutation({
  args: {},
  handler: async (ctx) => {
    const entries = await ctx.db.query("community_changelog").collect();
    let patched = 0;
    for (const entry of entries) {
      if (!entry.authorName) {
        const author = await ctx.db.get(entry.authorId);
        await ctx.db.patch(entry._id, {
          authorName: author?.fullName ?? "Unknown",
        });
        patched++;
      }
    }
    return { patched };
  },
});

/** Check if a commit SHA already has a changelog entry */
export const hasCommitEntry = internalQuery({
  args: { commitSha: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("community_changelog")
      .withIndex("by_commitSha", (q) => q.eq("commitSha", args.commitSha))
      .first();
    return !!existing;
  },
});

/** Delete all auto-generated entries (for cleanup before re-seed) */
export const clearAutoEntries = internalMutation({
  args: {
    repo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const entries = await ctx.db
      .query("community_changelog")
      .collect();

    let deleted = 0;
    for (const entry of entries) {
      if (entry.source === "auto") {
        // If repo filter provided, only delete that repo's entries
        if (args.repo && entry.repo !== args.repo) continue;
        await ctx.db.delete(entry._id);
        deleted++;
      }
    }

    // Clear sync state
    if (args.repo) {
      // Clear only the specified repo's sync state
      const syncState = await ctx.db
        .query("changelog_sync_state")
        .withIndex("by_repo", (q) => q.eq("repo", args.repo!))
        .first();
      if (syncState) {
        await ctx.db.delete(syncState._id);
      }
    } else {
      // Clear all sync state
      const allSyncState = await ctx.db
        .query("changelog_sync_state")
        .collect();
      for (const s of allSyncState) {
        await ctx.db.delete(s._id);
      }
    }

    return { deleted };
  },
});
