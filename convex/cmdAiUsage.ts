import { query, mutation } from "./_generated/server";
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
