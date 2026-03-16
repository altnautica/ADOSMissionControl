/**
 * @module cmdDrones
 * @description Convex functions for paired drones management.
 * User-facing functions require authentication. Heartbeat uses
 * deviceId + apiKey validation instead.
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

/** List all drones for the authenticated user. */
export const listMyDrones = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** Get single drone by ID, verify ownership. */
export const getDrone = query({
  args: { droneId: v.id("cmd_drones") },
  handler: async (ctx, { droneId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) return null;
    return drone;
  },
});

/** Get a drone by deviceId string (for HTTP route validation). */
export const getDroneByDeviceId = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    return await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
  },
});

/** Rename a paired drone. */
export const renameDrone = mutation({
  args: { droneId: v.id("cmd_drones"), name: v.string() },
  handler: async (ctx, { droneId, name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) throw new Error("Not found");
    await ctx.db.patch(droneId, { name });
  },
});

/** Unpair (delete) a drone. */
export const unpairDrone = mutation({
  args: { droneId: v.id("cmd_drones") },
  handler: async (ctx, { droneId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const drone = await ctx.db.get(droneId);
    if (!drone || drone.userId !== userId) throw new Error("Not found");
    await ctx.db.delete(droneId);
  },
});

/**
 * Agent heartbeat — called from HTTP handler.
 * Validates using deviceId + apiKey (no user auth).
 */
export const updateHeartbeat = mutation({
  args: {
    deviceId: v.string(),
    apiKey: v.string(),
    lastIp: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    fcConnected: v.optional(v.boolean()),
    agentVersion: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (!drone) return { error: "not_found" };
    if (drone.apiKey !== args.apiKey) return { error: "invalid_key" };
    await ctx.db.patch(drone._id, {
      lastSeen: Date.now(),
      lastIp: args.lastIp,
      mdnsHost: args.mdnsHost,
      fcConnected: args.fcConnected,
      agentVersion: args.agentVersion,
    });
    return { ok: true };
  },
});
