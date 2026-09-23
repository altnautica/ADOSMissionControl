import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

/**
 * Get the start of the current week (Monday 00:00 UTC).
 */
function getWeekStart(): number {
  const now = new Date();
  const day = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.getTime();
}

function getWeeklyLimit(): number {
  const raw = process.env.AI_PID_WEEKLY_LIMIT;
  if (!raw) return 3;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

export const checkAndRecord = mutation({
  args: { feature: v.string() },
  handler: async (ctx, { feature }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      return { allowed: false, remaining: 0, weeklyLimit: 0, error: "auth_required" };
    }

    const weeklyLimit = getWeeklyLimit();
    const weekStart = getWeekStart();

    const usageThisWeek = await ctx.db
      .query("cmd_ai_usage")
      .withIndex("by_userId_feature", (q) =>
        q.eq("userId", userId).eq("feature", feature)
      )
      .collect();

    const usedThisWeek = usageThisWeek.filter((u) => u.usedAt >= weekStart).length;

    if (usedThisWeek >= weeklyLimit) {
      return {
        allowed: false,
        remaining: 0,
        weeklyLimit,
        error: "weekly_limit_reached",
      };
    }

    await ctx.db.insert("cmd_ai_usage", {
      userId,
      feature,
      usedAt: Date.now(),
    });

    return {
      allowed: true,
      remaining: weeklyLimit - usedThisWeek - 1,
      weeklyLimit,
    };
  },
});

export const getRemaining = query({
  args: { feature: v.optional(v.string()) },
  handler: async (ctx, { feature: featureArg }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const feature = featureArg ?? "pid_analysis";
    const weeklyLimit = getWeeklyLimit();
    const weekStart = getWeekStart();

    const usageThisWeek = await ctx.db
      .query("cmd_ai_usage")
      .withIndex("by_userId_feature", (q) =>
        q.eq("userId", userId).eq("feature", feature)
      )
      .collect();

    const usedThisWeek = usageThisWeek.filter((u) => u.usedAt >= weekStart).length;

    return {
      remaining: Math.max(0, weeklyLimit - usedThisWeek),
      weeklyLimit,
      usedThisWeek,
    };
  },
});

/**
 * A usage row older than this can no longer count toward any quota: the week
 * starts on the most recent Monday 00:00 UTC, never more than seven days ago.
 */
const USAGE_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
/** Bounded so a backlog cannot blow the per-call limits. */
const USAGE_PRUNE_BATCH = 256;

/**
 * Cron job: delete usage rows past every quota window. One row lands per AI
 * call, so without this the table grows for the lifetime of the deployment.
 * Ranges `by_usedAt` so the cost tracks what is deleted, and reschedules while
 * a full batch went.
 */
export const pruneOldUsage = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - USAGE_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_ai_usage")
      .withIndex("by_usedAt", (q) => q.lt("usedAt", cutoff))
      .take(USAGE_PRUNE_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    if (stale.length === USAGE_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdAiUsage.pruneOldUsage, {});
    }
    return { deleted: stale.length };
  },
});
