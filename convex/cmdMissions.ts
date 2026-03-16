/**
 * @module cmdMissions
 * @description Convex functions for Command GCS mission cloud storage.
 * All functions require authentication. Missions are scoped to the
 * authenticated user's ID.
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const waypointValidator = v.object({
  id: v.string(),
  lat: v.number(),
  lon: v.number(),
  alt: v.number(),
  speed: v.optional(v.number()),
  holdTime: v.optional(v.number()),
  command: v.optional(v.string()),
  param1: v.optional(v.number()),
  param2: v.optional(v.number()),
  param3: v.optional(v.number()),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("cmd_missions")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const save = mutation({
  args: {
    name: v.string(),
    waypoints: v.array(waypointValidator),
    droneId: v.optional(v.string()),
    suiteType: v.optional(v.string()),
    existingId: v.optional(v.id("cmd_missions")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    if (args.existingId) {
      const existing = await ctx.db.get(args.existingId);
      if (!existing || existing.userId !== userId) {
        throw new Error("Mission not found");
      }
      await ctx.db.patch(args.existingId, {
        name: args.name,
        waypoints: args.waypoints,
        droneId: args.droneId,
        suiteType: args.suiteType,
        updatedAt: Date.now(),
      });
      return args.existingId;
    }

    return await ctx.db.insert("cmd_missions", {
      userId,
      name: args.name,
      waypoints: args.waypoints,
      droneId: args.droneId,
      suiteType: args.suiteType,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("cmd_missions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const existing = await ctx.db.get(args.id);
    if (!existing || existing.userId !== userId) {
      throw new Error("Mission not found");
    }
    await ctx.db.delete(args.id);
  },
});
