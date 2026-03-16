/**
 * @module cmdPreferences
 * @description Convex functions for Command GCS user preferences cloud sync.
 * Single preferences document per user, upserted on save.
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const pref = await ctx.db
      .query("cmd_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    return pref?.preferences ?? null;
  },
});

export const save = mutation({
  args: {
    preferences: v.object({
      mapTileSource: v.optional(v.string()),
      units: v.optional(v.string()),
      defaultAlt: v.optional(v.number()),
      defaultSpeed: v.optional(v.number()),
      defaultAcceptRadius: v.optional(v.number()),
      defaultFrame: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("cmd_preferences")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        preferences: args.preferences,
        updatedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("cmd_preferences", {
        userId,
        preferences: args.preferences,
        updatedAt: Date.now(),
      });
    }
  },
});
