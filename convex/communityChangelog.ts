import { query, mutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Most changelog ids one reactionCounts call may ask about: the notification
// modal asks about at most one listRecent window (100 entries).
const MAX_REACTION_TARGETS = 100;

const PUBLISHED_COUNT_KEY = "published";

async function countPublishedRows(ctx: QueryCtx): Promise<number> {
  const entries = await ctx.db
    .query("community_changelog")
    .withIndex("by_publishedAt", (q) => q.eq("published", true))
    .collect();
  return entries.length;
}

/**
 * Keep the published-entry counter in step with a write this mutation has
 * already made. The first write after the counter is introduced seeds it from
 * a full count, which already includes that write, so the delta is not added.
 */
export async function adjustPublishedCount(ctx: MutationCtx, delta: number): Promise<void> {
  const row = await ctx.db
    .query("community_changelog_counts")
    .withIndex("by_key", (q) => q.eq("key", PUBLISHED_COUNT_KEY))
    .first();
  if (!row) {
    await ctx.db.insert("community_changelog_counts", {
      key: PUBLISHED_COUNT_KEY,
      count: await countPublishedRows(ctx),
    });
    return;
  }
  if (delta !== 0) {
    await ctx.db.patch(row._id, { count: Math.max(0, row.count + delta) });
  }
}

/** Recount the published entries from the table, after a bulk rewrite. */
export async function recountPublished(ctx: MutationCtx): Promise<void> {
  const count = await countPublishedRows(ctx);
  const row = await ctx.db
    .query("community_changelog_counts")
    .withIndex("by_key", (q) => q.eq("key", PUBLISHED_COUNT_KEY))
    .first();
  if (row) await ctx.db.patch(row._id, { count });
  else await ctx.db.insert("community_changelog_counts", { key: PUBLISHED_COUNT_KEY, count });
}

async function callerIsAdmin(ctx: QueryCtx): Promise<boolean> {
  const userId = await getAuthUserId(ctx);
  if (!userId) return false;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_userId", (q) => q.eq("userId", userId))
    .first();
  return profile?.role === "admin";
}

// Hard upper bound on the rows `list` returns. It is the bounded read the
// plugin cloud-read allowlist exposes (`communityChangelog:list`), so it must
// not `.collect()` a growing table. The changelog timeline walks
// `listPaginated`; bounded "what's new" surfaces use `listRecent`.
const LIST_LIMIT = 1000;

/**
 * The most recently published entries, newest first, at most
 * {@link LIST_LIMIT} (or `limit`, when smaller).
 */
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const capped =
      args.limit === undefined
        ? LIST_LIMIT
        : Math.min(Math.max(args.limit, 1), LIST_LIMIT);
    const entries = await ctx.db
      .query("community_changelog")
      .withIndex("by_publishedAt", (q) => q.eq("published", true))
      .order("desc")
      .take(capped);

    return entries.map((entry) => ({
      ...entry,
      authorName: entry.authorName ?? "Unknown",
    }));
  },
});

export const listPaginated = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("community_changelog")
      .withIndex("by_publishedAt", (q) => q.eq("published", true))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((entry) => ({
        ...entry,
        authorName: entry.authorName ?? "Unknown",
      })),
    };
  },
});

export const listRecent = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => {
    const capped = Math.min(Math.max(args.limit, 1), 100);
    const entries = await ctx.db
      .query("community_changelog")
      .withIndex("by_publishedAt", (q) => q.eq("published", true))
      .order("desc")
      .take(capped);
    return entries.map((entry) => ({
      ...entry,
      authorName: entry.authorName ?? "Unknown",
    }));
  },
});

export const listCount = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db
      .query("community_changelog_counts")
      .withIndex("by_key", (q) => q.eq("key", PUBLISHED_COUNT_KEY))
      .first();
    // Until the first changelog write seeds the counter, count the rows.
    return row ? row.count : await countPublishedRows(ctx);
  },
});

/** A draft (unpublished) entry is visible to admins only. */
export const getByVersion = query({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("community_changelog")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .first();

    if (!entry) return null;
    if (!entry.published && !(await callerIsAdmin(ctx))) return null;
    return { ...entry, authorName: entry.authorName ?? "Unknown" };
  },
});

/** A draft (unpublished) entry is visible to admins only. */
export const getById = query({
  args: { id: v.id("community_changelog") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id);
    if (!entry) return null;
    if (!entry.published && !(await callerIsAdmin(ctx))) return null;
    return { ...entry, authorName: entry.authorName ?? "Unknown" };
  },
});

export const create = mutation({
  args: {
    version: v.string(),
    title: v.string(),
    body: v.string(),
    tags: v.optional(v.array(v.string())),
    published: v.boolean(),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    const id = await ctx.db.insert("community_changelog", {
      version: args.version,
      title: args.title,
      body: args.body,
      publishedAt: Date.now(),
      authorId: profile._id,
      authorName: profile.fullName ?? "Unknown",
      tags: args.tags,
      published: args.published,
      source: "manual",
      translations: args.translations,
    });
    await adjustPublishedCount(ctx, args.published ? 1 : 0);
    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("community_changelog"),
    version: v.optional(v.string()),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    published: v.optional(v.boolean()),
    translations: v.optional(v.record(v.string(), v.object({
      title: v.string(),
      description: v.string(),
    }))),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    const { id, ...updates } = args;
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined) filtered[key] = value;
    }

    // An empty translation map clears the stored translations.
    if (updates.translations && Object.keys(updates.translations).length === 0) {
      filtered.translations = undefined;
    }

    const existing = await ctx.db.get(id);
    // The rendered HTML was built from the old body; drop it so the edited
    // body is what renders.
    if (updates.body !== undefined && updates.body !== existing?.body) {
      filtered.bodyHtml = undefined;
    }
    // Mark auto entries as edited when admin modifies them
    if (existing?.source === "auto") {
      filtered.editedByAdmin = true;
    }

    await ctx.db.patch(id, filtered);
    if (existing && updates.published !== undefined && updates.published !== existing.published) {
      await adjustPublishedCount(ctx, updates.published ? 1 : -1);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("community_changelog") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile || profile.role !== "admin") {
      throw new Error("Admin access required");
    }

    const existing = await ctx.db.get(args.id);
    await ctx.db.delete(args.id);
    if (existing) await adjustPublishedCount(ctx, existing.published ? -1 : 0);
  },
});

export const react = mutation({
  args: {
    changelogId: v.id("community_changelog"),
    reaction: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("changelog_reactions")
      .withIndex("by_user_changelog", (q) =>
        q.eq("userId", userId).eq("changelogId", args.changelogId)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
      return { toggled: false };
    }

    await ctx.db.insert("changelog_reactions", {
      changelogId: args.changelogId,
      userId,
      reaction: args.reaction,
    });
    return { toggled: true };
  },
});

export const reactionCounts = query({
  args: { changelogIds: v.array(v.id("community_changelog")) },
  handler: async (ctx, args) => {
    if (args.changelogIds.length > MAX_REACTION_TARGETS) {
      throw new Error(`changelogIds may not exceed ${MAX_REACTION_TARGETS} entries`);
    }
    const out: Array<{ changelogId: (typeof args.changelogIds)[number]; count: number }> = [];
    for (const id of args.changelogIds) {
      const reactions = await ctx.db
        .query("changelog_reactions")
        .withIndex("by_changelog", (q) => q.eq("changelogId", id))
        .collect();
      out.push({ changelogId: id, count: reactions.length });
    }
    return out;
  },
});

export const myReactions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const reactions = await ctx.db
      .query("changelog_reactions")
      .withIndex("by_user_changelog", (q) => q.eq("userId", userId))
      .collect();

    return reactions.map((r) => r.changelogId);
  },
});
