import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

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

export const list = query({
  args: {
    type: v.optional(typeValidator),
    status: v.optional(statusValidator),
    category: v.optional(categoryValidator),
    sort: v.optional(v.union(v.literal("top"), v.literal("newest"))),
  },
  handler: async (ctx, args) => {
    let items;

    if (args.type && args.status) {
      items = await ctx.db
        .query("community_items")
        .withIndex("by_type_status", (q) =>
          q.eq("type", args.type!).eq("status", args.status!)
        )
        .collect();
    } else if (args.type) {
      items = await ctx.db
        .query("community_items")
        .withIndex("by_type_status", (q) => q.eq("type", args.type!))
        .collect();
    } else if (args.category) {
      items = await ctx.db
        .query("community_items")
        .withIndex("by_category", (q) => q.eq("category", args.category!))
        .collect();
    } else if (args.status) {
      items = await ctx.db
        .query("community_items")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    } else {
      items = await ctx.db.query("community_items").collect();
    }

    // Sort
    if (args.sort === "top") {
      items.sort((a, b) => b.upvoteCount - a.upvoteCount);
    } else {
      // newest first (default)
      items.sort((a, b) => b._creationTime - a._creationTime);
    }

    // Join author names
    const results = [];
    for (const item of items) {
      const author = await ctx.db.get(item.authorId);
      results.push({
        ...item,
        authorName: author?.fullName ?? "Unknown",
      });
    }

    return results;
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

export const listByStatus = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("community_items").collect();

    const grouped: Record<string, Array<typeof items[number] & { authorName: string }>> = {
      backlog: [],
      in_discussion: [],
      planned: [],
      in_progress: [],
      released: [],
      wont_do: [],
    };

    for (const item of items) {
      const author = await ctx.db.get(item.authorId);
      grouped[item.status].push({
        ...item,
        authorName: author?.fullName ?? "Unknown",
      });
    }

    // Sort each column by upvotes descending
    for (const status of Object.keys(grouped)) {
      grouped[status].sort((a, b) => b.upvoteCount - a.upvoteCount);
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
