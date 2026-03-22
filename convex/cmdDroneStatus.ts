/**
 * @module cmdDroneStatus
 * @description Convex functions for drone cloud status relay.
 * Agent pushes full system status via HTTP action. GCS reads via reactive query.
 * @license GPL-3.0-only
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Push status from agent (called via HTTP action, no auth — validated by API key match).
 * Upserts by deviceId.
 */
export const pushStatus = mutation({
  args: {
    deviceId: v.string(),
    version: v.string(),
    uptimeSeconds: v.number(),
    boardName: v.optional(v.string()),
    boardTier: v.optional(v.number()),
    boardSoc: v.optional(v.string()),
    boardArch: v.optional(v.string()),
    cpuPercent: v.optional(v.number()),
    memoryPercent: v.optional(v.number()),
    diskPercent: v.optional(v.number()),
    temperature: v.optional(v.float64()),
    fcConnected: v.optional(v.boolean()),
    fcPort: v.optional(v.string()),
    fcBaud: v.optional(v.number()),
    // Absolute resource values
    memoryUsedMb: v.optional(v.number()),
    memoryTotalMb: v.optional(v.number()),
    diskUsedGb: v.optional(v.number()),
    diskTotalGb: v.optional(v.number()),
    cpuCores: v.optional(v.number()),
    boardRamMb: v.optional(v.number()),
    // Process-level totals
    processCpuPercent: v.optional(v.number()),
    processMemoryMb: v.optional(v.number()),
    // History arrays for sparkline charts
    cpuHistory: v.optional(v.array(v.number())),
    memoryHistory: v.optional(v.array(v.number())),
    services: v.optional(v.array(v.object({
      name: v.string(),
      status: v.string(),
      cpuPercent: v.optional(v.number()),
      memoryMb: v.optional(v.number()),
      uptimeSeconds: v.optional(v.number()),
      pid: v.optional(v.number()),
      category: v.optional(v.string()),
    }))),
    lastIp: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    peripherals: v.optional(v.any()),
    scripts: v.optional(v.any()),
    suites: v.optional(v.any()),
    enrollment: v.optional(v.any()),
    peers: v.optional(v.any()),
    logs: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert("cmd_droneStatus", { ...args, updatedAt: now });
    }

    // Also update the cmd_drones table lastSeen, fcConnected, lastIp
    const drone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (drone) {
      await ctx.db.patch(drone._id, {
        lastSeen: now,
        fcConnected: args.fcConnected,
        lastIp: args.lastIp,
        mdnsHost: args.mdnsHost,
      });
    }

    return { ok: true };
  },
});

/**
 * Get cloud status for a specific drone.
 */
export const getCloudStatus = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    return await ctx.db
      .query("cmd_droneStatus")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();
  },
});
