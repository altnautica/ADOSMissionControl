import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// Hard upper bound on the rows the deprecated `list` query returns. The
// changelog timeline uses `listPaginated`; this legacy query is reachable
// from the plugin cloud-read allowlist, so it must not unbounded-`.collect()`
// a growing table. A caller that needs the full history walks
// `listPaginated`.
const LEGACY_LIST_LIMIT = 1000;

/**
 * @deprecated Returns at most {@link LEGACY_LIST_LIMIT} of the most recently
 * published entries. Use listPaginated for scroll surfaces and listRecent for
 * bounded "what's new" contexts.
 */
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    // Bounded at the read so a large changelog stays cheap (was an
    // unbounded `.collect()` followed by an in-memory slice).
    const capped =
      args.limit === undefined
        ? LEGACY_LIST_LIMIT
        : Math.min(Math.max(args.limit, 1), LEGACY_LIST_LIMIT);
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
    const entries = await ctx.db
      .query("community_changelog")
      .withIndex("by_publishedAt", (q) => q.eq("published", true))
      .collect();
    return entries.length;
  },
});

export const getByVersion = query({
  args: { version: v.string() },
  handler: async (ctx, args) => {
    const entry = await ctx.db
      .query("community_changelog")
      .withIndex("by_version", (q) => q.eq("version", args.version))
      .first();

    if (!entry) return null;
    return { ...entry, authorName: entry.authorName ?? "Unknown" };
  },
});

export const getById = query({
  args: { id: v.id("community_changelog") },
  handler: async (ctx, args) => {
    const entry = await ctx.db.get(args.id);
    if (!entry) return null;
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

    return await ctx.db.insert("community_changelog", {
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

    // Mark auto entries as edited when admin modifies them
    const existing = await ctx.db.get(id);
    if (existing?.source === "auto") {
      filtered.editedByAdmin = true;
    }

    await ctx.db.patch(id, filtered);
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

    await ctx.db.delete(args.id);
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
