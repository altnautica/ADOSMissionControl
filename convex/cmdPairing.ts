/**
 * @module cmdPairing
 * @description Convex functions for the ADOS drone pairing system.
 * Supports two flows:
 * 1. Agent-initiated: agent generates code → user enters code in GCS
 * 2. User-initiated: user pre-generates code → agent uses it during install
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const SAFE_CHARSET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CODE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/** User claims a pairing code (enters code displayed on agent terminal). */
export const claimPairingCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const request = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) =>
        q.eq("pairingCode", code.toUpperCase())
      )
      .first();

    if (!request) throw new Error("Invalid pairing code");
    if (request.expiresAt < Date.now()) {
      await ctx.db.delete(request._id);
      throw new Error("Pairing code expired");
    }
    if (request.claimedBy) throw new Error("Code already claimed");

    // Mark as claimed
    await ctx.db.patch(request._id, {
      claimedBy: userId,
      claimedAt: Date.now(),
    });

    // Upsert: update existing drone record if same user + device
    const deviceId = request.deviceId || `device-${code}`;
    const existingDrone = await ctx.db
      .query("cmd_drones")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("deviceId"), deviceId))
      .first();

    let droneId;
    if (existingDrone) {
      await ctx.db.patch(existingDrone._id, {
        apiKey: request.apiKey || "",
        agentVersion: request.agentVersion,
        board: request.board,
        tier: request.tier,
        os: request.os,
        mdnsHost: request.mdnsHost,
        lastIp: request.localIp,
        lastSeen: Date.now(),
        pairedAt: Date.now(),
      });
      droneId = existingDrone._id;
    } else {
      droneId = await ctx.db.insert("cmd_drones", {
        userId,
        deviceId,
        name: request.agentName || `Drone ${code}`,
        apiKey: request.apiKey || "",
        agentVersion: request.agentVersion,
        board: request.board,
        tier: request.tier,
        os: request.os,
        mdnsHost: request.mdnsHost,
        lastIp: request.localIp,
        lastSeen: Date.now(),
        fcConnected: false,
        pairedAt: Date.now(),
      });
    }

    return {
      droneId,
      apiKey: request.apiKey || "",
      mdnsHost: request.mdnsHost,
      localIp: request.localIp,
      deviceId,
      name: existingDrone?.name || request.agentName,
    };
  },
});

/** User pre-generates a pairing code (for zero-touch install). */
export const preGenerateCode = mutation({
  args: { code: v.optional(v.string()) },
  handler: async (ctx, { code }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    let pairingCode = code?.toUpperCase() || "";
    if (!pairingCode) {
      for (let i = 0; i < CODE_LENGTH; i++) {
        pairingCode +=
          SAFE_CHARSET[Math.floor(Math.random() * SAFE_CHARSET.length)];
      }
    }

    const requestId = await ctx.db.insert("cmd_pairingRequests", {
      pairingCode,
      expiresAt: Date.now() + CODE_TTL_MS,
      createdBy: userId,
    });

    return { requestId, code: pairingCode };
  },
});

/**
 * Agent polls to check if its code was claimed.
 * No auth required — uses deviceId lookup.
 */
export const getPairingStatus = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const request = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .first();

    if (!request) return { registered: false };

    return {
      registered: true,
      claimed: !!request.claimedBy,
      claimedBy: request.claimedBy,
      claimedAt: request.claimedAt,
    };
  },
});

/** User sees their pre-generated (unclaimed) codes. */
export const getMyPendingCodes = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .filter((q) => q.eq(q.field("claimedBy"), undefined))
      .collect();
  },
});

/**
 * Called by HTTP handler when agent registers its pairing request.
 * No user auth — this is the agent-side of the pairing flow.
 * Handles upsert and auto-matching with pre-generated codes.
 */
export const registerAgent = mutation({
  args: {
    deviceId: v.string(),
    pairingCode: v.string(),
    apiKey: v.optional(v.string()),
    name: v.optional(v.string()),
    version: v.optional(v.string()),
    board: v.optional(v.string()),
    tier: v.optional(v.number()),
    os: v.optional(v.string()),
    mdnsHost: v.optional(v.string()),
    localIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Delete existing request for this device if any
    const existing = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId))
      .first();
    if (existing) {
      if (existing.claimedBy) return { alreadyClaimed: true };
      await ctx.db.delete(existing._id);
    }

    // Check if a pre-generated code matches (zero-touch flow)
    const preGenerated = await ctx.db
      .query("cmd_pairingRequests")
      .withIndex("by_pairingCode", (q) =>
        q.eq("pairingCode", args.pairingCode)
      )
      .first();
    if (preGenerated && preGenerated.createdBy && !preGenerated.claimedBy) {
      // Auto-match: pre-generated code found, auto-claim it
      await ctx.db.patch(preGenerated._id, {
        deviceId: args.deviceId,
        agentName: args.name,
        agentVersion: args.version,
        board: args.board,
        tier: args.tier,
        os: args.os,
        apiKey: args.apiKey,
        mdnsHost: args.mdnsHost,
        localIp: args.localIp,
        claimedBy: preGenerated.createdBy!,
        claimedAt: Date.now(),
      });
      // Upsert drone record
      const ownerId = preGenerated.createdBy!;
      const existingDrone = await ctx.db
        .query("cmd_drones")
        .withIndex("by_userId", (q) => q.eq("userId", ownerId))
        .filter((q) => q.eq(q.field("deviceId"), args.deviceId))
        .first();

      if (existingDrone) {
        await ctx.db.patch(existingDrone._id, {
          apiKey: args.apiKey || "",
          agentVersion: args.version,
          board: args.board,
          tier: args.tier,
          os: args.os,
          mdnsHost: args.mdnsHost,
          lastIp: args.localIp,
          lastSeen: Date.now(),
          pairedAt: Date.now(),
        });
      } else {
        await ctx.db.insert("cmd_drones", {
          userId: ownerId,
          deviceId: args.deviceId,
          name: args.name || `Drone ${args.pairingCode}`,
          apiKey: args.apiKey || "",
          agentVersion: args.version,
          board: args.board,
          tier: args.tier,
          os: args.os,
          mdnsHost: args.mdnsHost,
          lastIp: args.localIp,
          lastSeen: Date.now(),
          fcConnected: false,
          pairedAt: Date.now(),
        });
      }
      return { autoMatched: true, userId: ownerId };
    }

    // Insert new pairing request
    await ctx.db.insert("cmd_pairingRequests", {
      deviceId: args.deviceId,
      pairingCode: args.pairingCode,
      agentName: args.name,
      agentVersion: args.version,
      board: args.board,
      tier: args.tier,
      os: args.os,
      apiKey: args.apiKey,
      mdnsHost: args.mdnsHost,
      localIp: args.localIp,
      expiresAt: Date.now() + CODE_TTL_MS,
    });

    return { registered: true };
  },
});

/** Cron job: clean expired pairing requests. */
export const cleanExpiredRequests = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query("cmd_pairingRequests")
      .filter((q) => q.lt(q.field("expiresAt"), now))
      .collect();
    for (const req of expired) {
      await ctx.db.delete(req._id);
    }
    return { deleted: expired.length };
  },
});
