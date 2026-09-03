import { query, mutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Infer } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

const targetTypeValidator = v.union(
  v.literal("update"),
  v.literal("milestone"),
  v.literal("document"),
  v.literal("general"),
  v.literal("grant"),
  v.literal("changelog"),
  v.literal("community_item")
);

const COMMUNITY_TARGET_TYPES = new Set(["changelog", "community_item"]);

type TargetType = Infer<typeof targetTypeValidator>;

export const list = query({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Community target types: any authenticated user with a profile can view
    // Other target types: investor or admin only
    if (!profile) return [];
    if (!COMMUNITY_TARGET_TYPES.has(args.targetType) &&
        profile.role !== "investor" && profile.role !== "admin") {
      return [];
    }

    const comments = await ctx.db
      .query("comments")
      .withIndex("by_target", (q) =>
        q.eq("targetType", args.targetType).eq("targetId", args.targetId)
      )
      .order("asc")
      .collect();

    // Join author profiles and filter soft-deleted for non-admins
    const results = [];
    for (const comment of comments) {
      if (comment.deleted && profile.role !== "admin") continue;

      const author = await ctx.db.get(comment.authorId);
      results.push({
        ...comment,
        authorName: author?.fullName ?? "Unknown",
        authorRole: author?.role ?? "pending",
      });
    }

    return results;
  },
});

export const create = mutation({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
    body: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .first();

    // Community target types: any authenticated user with a profile
    // Other target types: investor or admin only
    if (!profile) throw new Error("Profile required");
    if (!COMMUNITY_TARGET_TYPES.has(args.targetType) &&
        profile.role !== "investor" && profile.role !== "admin") {
      throw new Error("Investor or admin access required");
    }

    const body = args.body.trim();
    if (!body) throw new Error("Comment body cannot be empty");
    if (body.length > 2000) throw new Error("Comment body too long (max 2000 characters)");

    return await ctx.db.insert("comments", {
      targetType: args.targetType,
      targetId: args.targetId,
      authorId: profile._id,
      body,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("comments") },
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

    await ctx.db.patch(args.id, { deleted: true });
  },
});

/**
 * Upper bound on the comments either count query walks per target. A badge
 * renders "99+" long before this; the point is that an unbounded `.collect()`
 * on a growing thread is a per-request cost an anonymous caller sets.
 */
const MAX_COUNTED_PER_TARGET = 500;

/**
 * Upper bound on the targets one batch call may ask about. Unbounded, this was
 * request amplification: one anonymous query, N indexed `.collect()`s, N chosen
 * by the caller. A comment-count row renders one badge per visible card, so a
 * page never legitimately asks for more than a screenful.
 */
const MAX_COUNT_TARGETS = 64;

/** Live (non-deleted) comments on one target, capped at MAX_COUNTED_PER_TARGET. */
async function countLiveComments(
  ctx: QueryCtx,
  targetType: TargetType,
  targetId: string,
): Promise<number> {
  const comments = await ctx.db
    .query("comments")
    .withIndex("by_target", (q) =>
      q.eq("targetType", targetType).eq("targetId", targetId)
    )
    .take(MAX_COUNTED_PER_TARGET);
  return comments.filter((c) => !c.deleted).length;
}

export const countByTarget = query({
  args: {
    targetType: targetTypeValidator,
    targetId: v.string(),
  },
  handler: async (ctx, args) =>
    await countLiveComments(ctx, args.targetType, args.targetId),
});

export const countByTargets = query({
  args: {
    targets: v.array(
      v.object({
        targetType: targetTypeValidator,
        targetId: v.string(),
      })
    ),
  },
  handler: async (ctx, args) => {
    if (args.targets.length > MAX_COUNT_TARGETS) {
      throw new Error(`targets may not exceed ${MAX_COUNT_TARGETS} entries`);
    }
    // De-duplicate before reading: a caller repeating one target 64 times
    // otherwise buys 64 index scans for one answer.
    const seen = new Set<string>();
    const out: Array<{
      targetType: TargetType;
      targetId: string;
      count: number;
    }> = [];
    for (const { targetType, targetId } of args.targets) {
      const key = `${targetType}\u0000${targetId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        targetType,
        targetId,
        count: await countLiveComments(ctx, targetType, targetId),
      });
    }
    return out;
  },
});
