import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Most items one public list read returns (newest first), and most per
// status column on the board.
const LIST_LIMIT = 200;
const COLUMN_LIMIT = 100;

/** Attach author names, reading each distinct author once. */
async function withAuthorNames(
  ctx: QueryCtx,
  items: Doc<"community_items">[],
): Promise<Array<Doc<"community_items"> & { authorName: string }>> {
  const names = new Map<Id<"profiles">, string>();
  for (const item of items) {
    if (names.has(item.authorId)) continue;
    const author = await ctx.db.get(item.authorId);
    names.set(item.authorId, author?.fullName ?? "Unknown");
  }
  return items.map((item) => ({ ...item, authorName: names.get(item.authorId) ?? "Unknown" }));
}

const typeValidator = v.union(v.literal("feature"), v.literal("bug"));
const statusValidator = v.union(
  v.literal("backlog"),
  v.literal("in_discussion"),
  v.literal("planned"),
  v.literal("in_progress"),
  v.literal("released"),
  v.literal("wont_do"),
);
const categoryValidator = v.union(
  v.literal("command"),
  v.literal("ados"),
  v.literal("website"),
  v.literal("general"),
);
const priorityValidator = v.union(
  v.literal("low"),
  v.literal("medium"),
  v.literal("high"),
  v.literal("critical"),
);

/**
 * Public roadmap list, newest first, at most {@link LIST_LIMIT} items. Every
 * supplied filter applies: the narrowest index serves the read and any
 * remaining filter is applied in the same query. `sort: "top"` orders the
 * returned window by upvotes.
 */
export const list = query({
  args: {
    type: v.optional(typeValidator),
    status: v.optional(statusValidator),
    category: v.optional(categoryValidator),
    sort: v.optional(v.union(v.literal("top"), v.literal("newest"))),
  },
  handler: async (ctx, args) => {
    const { type, status, category } = args;
    const base = type
      ? ctx.db
          .query("community_items")
          .withIndex("by_type_status", (q) =>
            status ? q.eq("type", type).eq("status", status) : q.eq("type", type),
          )
      : category
        ? ctx.db.query("community_items").withIndex("by_category", (q) => q.eq("category", category))
        : status
          ? ctx.db.query("community_items").withIndex("by_status", (q) => q.eq("status", status))
          : ctx.db.query("community_items");
    const items = await base
      .filter((q) =>
        q.and(
          category && type ? q.eq(q.field("category"), category) : true,
          status && !type && category ? q.eq(q.field("status"), status) : true,
        ),
      )
      .order("desc")
      .take(LIST_LIMIT);

    if (args.sort === "top") {
      items.sort((a, b) => b.upvoteCount - a.upvoteCount);
    } else {
      items.sort((a, b) => b._creationTime - a._creationTime);
    }
    return await withAuthorNames(ctx, items);
  },
});

export const get = query({
  args: { id: v.id("community_items") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (!item) return null;

    const author = await ctx.db.get(item.authorId);
    return { ...item, authorName: author?.fullName ?? "Unknown" };
  },
});

const BOARD_STATUSES = [
  "backlog",
  "in_discussion",
  "planned",
  "in_progress",
  "released",
  "wont_do",
] as const;

/** The roadmap board: the newest {@link COLUMN_LIMIT} items per status, by upvotes. */
export const listByStatus = query({
  args: {},
  handler: async (ctx) => {
    const grouped: Record<string, Array<Doc<"community_items"> & { authorName: string }>> = {};
    for (const status of BOARD_STATUSES) {
      const items = await ctx.db
        .query("community_items")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("desc")
        .take(COLUMN_LIMIT);
      items.sort((a, b) => b.upvoteCount - a.upvoteCount);
      grouped[status] = await withAuthorNames(ctx, items);
    }
    return grouped;
  },
});

export const myUpvotes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const upvotes = await ctx.db
      .query("community_upvotes")
      .withIndex("by_user_item", (q) => q.eq("userId", userId))
      .collect();

    return upvotes.map((u) => u.itemId);
  },
});

export const create = mutation({
  args: {
    type: typeValidator,
    title: v.string(),
    body: v.string(),
    category: categoryValidator,
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile required");

    const title = args.title.trim();
    const body = args.body.trim();
    if (!title) throw new Error("Title cannot be empty");
    if (title.length > 200) throw new Error("Title too long (max 200 characters)");
    if (!body) throw new Error("Body cannot be empty");
    if (body.length > 5000) throw new Error("Body too long (max 5000 characters)");

    return await ctx.db.insert("community_items", {
      type: args.type,
      title,
      body,
      authorId: profile._id,
      status: "backlog",
      category: args.category,
      upvoteCount: 0,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("community_items"),
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    category: v.optional(categoryValidator),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();
    if (!profile) throw new Error("Profile required");

    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Item not found");

    // Author or admin can edit
    if (item.authorId !== profile._id && profile.role !== "admin") {
      throw new Error("Not authorized to edit this item");
    }

    const updates: Record<string, unknown> = {};
    if (args.title !== undefined) {
      const title = args.title.trim();
      if (!title) throw new Error("Title cannot be empty");
      if (title.length > 200) throw new Error("Title too long (max 200 characters)");
      updates.title = title;
    }
    if (args.body !== undefined) {
      const body = args.body.trim();
      if (!body) throw new Error("Body cannot be empty");
      if (body.length > 5000) throw new Error("Body too long (max 5000 characters)");
      updates.body = body;
    }
    if (args.category !== undefined) updates.category = args.category;

    await ctx.db.patch(args.id, updates);
  },
});

export const updateStatus = mutation({
  args: {
    id: v.id("community_items"),
    status: v.optional(statusValidator),
    priority: v.optional(priorityValidator),
    eta: v.optional(v.string()),
    resolvedVersion: v.optional(v.string()),
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

    await ctx.db.patch(id, filtered);
  },
});

export const remove = mutation({
  args: { id: v.id("community_items") },
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

    // Also delete associated upvotes
    const upvotes = await ctx.db
      .query("community_upvotes")
      .withIndex("by_item", (q) => q.eq("itemId", args.id))
      .collect();
    for (const upvote of upvotes) {
      await ctx.db.delete(upvote._id);
    }

    await ctx.db.delete(args.id);
  },
});

export const upvote = mutation({
  args: { id: v.id("community_items") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const item = await ctx.db.get(args.id);
    if (!item) throw new Error("Item not found");

    // Check if already upvoted
    const existing = await ctx.db
      .query("community_upvotes")
      .withIndex("by_user_item", (q) =>
        q.eq("userId", userId).eq("itemId", args.id)
      )
      .first();

    if (existing) {
      // Remove upvote (toggle off)
      await ctx.db.delete(existing._id);
      await ctx.db.patch(args.id, { upvoteCount: Math.max(0, item.upvoteCount - 1) });
      return { upvoted: false };
    } else {
      // Add upvote (toggle on)
      await ctx.db.insert("community_upvotes", {
        itemId: args.id,
        userId,
      });
      await ctx.db.patch(args.id, { upvoteCount: item.upvoteCount + 1 });
      return { upvoted: true };
    }
  },
});
