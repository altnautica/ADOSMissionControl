/**
 * @module cmdDroneCommands
 * @description Convex functions for cloud command relay.
 * GCS enqueues commands, agent polls and acknowledges.
 * @license GPL-3.0-only
 */

import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  requireCommandForDevice,
  requireOwnedCommand,
  requireOwnedDroneByDeviceId,
} from "./cmdDroneAccess";
import { settleInstallJobFromAck } from "./cmdPluginInstallJobs";
import { relayCommandValidator } from "./commandVocabulary";

/**
 * Bounds on a caller-supplied delivery window. The ceiling keeps a queued
 * flight command from executing long after the operator sent it; the floor
 * leaves room for at least one agent poll.
 */
const MIN_COMMAND_TTL_MS = 1_000;
const MAX_COMMAND_TTL_MS = 60_000;

/** Result message for a row whose delivery window closed before the agent took it. */
const EXPIRED_BEFORE_DELIVERY = "command expired: not delivered to the node in time";

/**
 * Enqueue a command for a drone (called from GCS).
 */
export const enqueueCommand = mutation({
  args: {
    deviceId: v.string(),
    // Validate the command name against the permitted vocabulary at the queue
    // boundary so a typo or a forged name cannot land a dead row the agent
    // silently ignores. The GCS is the single source of truth for the
    // command names the agent dispatcher acts on.
    command: relayCommandValidator,
    args: v.optional(v.any()),
    // Delivery window in ms, measured on the server clock. A row the agent has
    // not taken within it is never handed out: the poll fails it instead. Flight
    // commands set it so one queued while the node was unreachable cannot
    // execute when the node comes back.
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const drone = await requireOwnedDroneByDeviceId(ctx, args.deviceId);

    const createdAt = Date.now();
    let expiresAt: number | undefined;
    if (args.ttlMs !== undefined) {
      if (!Number.isFinite(args.ttlMs)) {
        throw new Error("ttlMs must be a finite number of milliseconds");
      }
      expiresAt =
        createdAt +
        Math.min(Math.max(args.ttlMs, MIN_COMMAND_TTL_MS), MAX_COMMAND_TTL_MS);
    }

    const id = await ctx.db.insert("cmd_droneCommands", {
      deviceId: args.deviceId,
      userId: drone.userId,
      command: args.command,
      args: args.args,
      status: "pending",
      createdAt,
      ...(expiresAt !== undefined ? { expiresAt } : {}),
    });
    return { commandId: id };
  },
});

// Maximum rows handed to one agent poll. Bounds the unbounded fan-out where
// a backlog of queued commands would all return on a single poll.
const MAX_DELIVERY_BATCH = 25;

// Lease window for a claimed ("delivering") row. If the agent crashes or
// loses its ack between claim and ack, the lease expires after this window and
// the next poll may reclaim the row.
const CLAIM_LEASE_MS = 60_000;

// Delivery attempt budget. After this many claims with no terminal ack the
// row is failed as undeliverable so a non-idempotent command cannot loop.
const MAX_DELIVERY_ATTEMPTS = 5;

// Delivery window for a row queued without an explicit TTL. A command the node
// has not taken within it is failed rather than run long after the operator
// who queued it stopped watching.
const DEFAULT_DELIVERY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Claim the device's deliverable commands (the agent's poll route). The only
 * delivery path.
 *
 * Atomically leases each row by flipping pending -> delivering with a fresh
 * `claimedAt` and an incremented `attempts`; the first claim also stamps
 * `deliveredAt`, which is how a watcher tells "the node has it" apart from
 * "still queued". The agent executes the returned commands and acks each to a
 * terminal status.
 *
 *  - A row still inside its lease belongs to an in-flight agent run and is not
 *    handed out again, so a slow ack never re-executes a command.
 *  - A delivering row whose lease expired (the agent crashed or its ack was
 *    lost) is re-leased, bounded by `MAX_DELIVERY_ATTEMPTS`.
 *  - A row past its delivery window (`expiresAt`, or `createdAt` plus the
 *    default window) is failed, never leased: a command queued while the node
 *    was away must not execute when it comes back.
 *
 * The mutation runs in one transaction, so two concurrent polls for the same
 * device serialize: the first claim moves the row out of the set the second
 * one sees.
 */
export const claimCommands = internalMutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const now = Date.now();

    const pending = await ctx.db
      .query("cmd_droneCommands")
      .withIndex("by_deviceId_status", (q) =>
        q.eq("deviceId", deviceId).eq("status", "pending")
      )
      .collect();

    const delivering = await ctx.db
      .query("cmd_droneCommands")
      .withIndex("by_deviceId_status", (q) =>
        q.eq("deviceId", deviceId).eq("status", "delivering")
      )
      .collect();

    const reclaimable = delivering.filter(
      (row) => (row.claimedAt ?? 0) + CLAIM_LEASE_MS <= now,
    );

    // Oldest first so a backlog drains in order; cap the batch.
    const candidates = [...pending, ...reclaimable]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_DELIVERY_BATCH);

    const claimed: Array<typeof candidates[number]> = [];
    for (const row of candidates) {
      const deadline = row.expiresAt ?? row.createdAt + DEFAULT_DELIVERY_WINDOW_MS;
      if (deadline <= now) {
        await ctx.db.patch(row._id, {
          status: "failed",
          result: {
            success: false,
            message:
              row.status === "pending"
                ? EXPIRED_BEFORE_DELIVERY
                : "command expired: claimed by the node but never acknowledged",
          },
          completedAt: now,
        });
        continue;
      }
      const attempts = (row.attempts ?? 0) + 1;
      if (attempts > MAX_DELIVERY_ATTEMPTS) {
        await ctx.db.patch(row._id, {
          status: "failed",
          result: {
            success: false,
            message: "command undeliverable: delivery attempts exhausted",
          },
          completedAt: now,
        });
        continue;
      }
      const deliveredAt = row.deliveredAt ?? now;
      await ctx.db.patch(row._id, {
        status: "delivering",
        claimedAt: now,
        attempts,
        deliveredAt,
      });
      claimed.push({ ...row, status: "delivering", claimedAt: now, attempts, deliveredAt });
    }

    return claimed;
  },
});

/**
 * Acknowledge a command (called by agent via HTTP).
 *
 * Only a row still awaiting its verdict (pending or delivering) takes an ack.
 * A row already terminal — failed as expired, cancelled by the GCS, or acked
 * once — keeps its verdict: a late ack is ignored, never allowed to overwrite
 * it.
 */
export const ackCommand = internalMutation({
  args: {
    commandId: v.id("cmd_droneCommands"),
    // Required, so the row can be bound to the device whose API key the HTTP
    // route just verified. Without it an agent holding one device's valid key
    // could ack, and write arbitrary `data` into, any other device's row.
    deviceId: v.string(),
    status: v.union(v.literal("completed"), v.literal("failed")),
    result: v.optional(v.object({
      success: v.boolean(),
      message: v.string(),
    })),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { commandId, deviceId, status, result, data }) => {
    const command = await requireCommandForDevice(ctx, commandId, deviceId);
    if (command.status !== "pending" && command.status !== "delivering") {
      return { ok: true, ignored: true };
    }
    await ctx.db.patch(commandId, {
      status,
      result,
      data,
      completedAt: Date.now(),
    });
    await settleInstallJobFromAck(ctx, command, { status, result, data });
    return { ok: true };
  },
});

/**
 * Get status of a specific command.
 */
export const getCommandStatus = query({
  args: { commandId: v.id("cmd_droneCommands") },
  handler: async (ctx, { commandId }) => {
    return await requireOwnedCommand(ctx, commandId);
  },
});

/**
 * List recent commands for a device.
 */
export const listRecentCommands = query({
  args: { deviceId: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { deviceId, limit }) => {
    await requireOwnedDroneByDeviceId(ctx, deviceId);
    const results = await ctx.db
      .query("cmd_droneCommands")
      .withIndex("by_deviceId_createdAt", (q) => q.eq("deviceId", deviceId))
      .order("desc")
      .take(limit ?? 20);
    return results;
  },
});

// How long a terminal command row is retained before the sweep deletes it.
const COMMAND_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Per-status delete cap per call so a large backlog cannot exceed the
// per-call transaction limits; a full batch reschedules the sweep at once.
const COMMAND_PRUNE_BATCH = 256;

/**
 * Retention sweep (cron-only): delete terminal command rows older than the
 * retention window so cmd_droneCommands does not grow without bound. Walks
 * the `by_status_completedAt` index per terminal status with a bounded range
 * + batch, so the cost is proportional to what is being deleted, not the
 * whole table.
 */
export const pruneTerminalCommands = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - COMMAND_RETENTION_MS;
    let deleted = 0;
    let full = false;
    for (const status of ["completed", "failed"] as const) {
      const stale = await ctx.db
        .query("cmd_droneCommands")
        .withIndex("by_status_completedAt", (q) =>
          q.eq("status", status).lt("completedAt", cutoff),
        )
        .take(COMMAND_PRUNE_BATCH);
      for (const row of stale) {
        await ctx.db.delete(row._id);
        deleted += 1;
      }
      if (stale.length === COMMAND_PRUNE_BATCH) full = true;
    }
    // A full batch means the range may hold more: drain it now rather than
    // waiting a whole cron interval per batch.
    if (full) {
      await ctx.scheduler.runAfter(0, internal.cmdDroneCommands.pruneTerminalCommands, {});
    }
    return { deleted };
  },
});

/**
 * How long a command may sit undelivered before the sweep calls it stuck.
 *
 * The agent polls every 5 s, so an hour without delivery means the node was
 * away, not slow. Expiring the row matters more than reaping it: the relay
 * vocabulary includes non-idempotent actions (service restart, WFB pair
 * init/apply/unpair), and a `pending` row is handed to the agent the moment it
 * comes back -- so an hour-old restart executes long after the operator who
 * queued it stopped watching.
 */
const COMMAND_STUCK_MS = 60 * 60 * 1000;

/**
 * Cron job: fail commands that were never delivered, or were claimed and never
 * acked, before their age makes execution a surprise.
 *
 * Failed rather than deleted, on purpose: the operator's command list then says
 * "expired: never delivered" instead of the row vanishing with no account of
 * what happened. Stamping `completedAt` hands the row to the terminal sweep
 * above, which is what finally frees the space. Reads through
 * `by_status_createdAt` (a non-terminal row has no `completedAt`, so the
 * terminal index cannot range it) and is bounded per tick.
 */
export const expireStuckCommands = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ expired: number }> => {
    const now = Date.now();
    const cutoff = now - COMMAND_STUCK_MS;
    let expired = 0;
    let full = false;
    for (const status of ["pending", "delivering"] as const) {
      const stuck = await ctx.db
        .query("cmd_droneCommands")
        .withIndex("by_status_createdAt", (q) =>
          q.eq("status", status).lt("createdAt", cutoff),
        )
        .take(COMMAND_PRUNE_BATCH);
      for (const row of stuck) {
        await ctx.db.patch(row._id, {
          status: "failed",
          result: {
            success: false,
            message:
              status === "pending"
                ? "command expired: never delivered to the node"
                : "command expired: claimed by the node but never acknowledged",
          },
          completedAt: now,
        });
        expired += 1;
      }
      if (stuck.length === COMMAND_PRUNE_BATCH) full = true;
    }
    // Expiry moves each row out of the range, so a full batch drains on.
    if (full) {
      await ctx.scheduler.runAfter(0, internal.cmdDroneCommands.expireStuckCommands, {});
    }
    return { expired };
  },
});
