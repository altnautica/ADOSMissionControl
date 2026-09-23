/**
 * @module cmdDroneCommands
 * @description Convex functions for cloud command relay.
 * GCS enqueues commands, agent polls and acknowledges.
 * @license GPL-3.0-only
 */

import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
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
// disconnects between claim and ack, the lease expires after this window and
// the next poll may reclaim the row.
const CLAIM_LEASE_MS = 60_000;

// Delivery attempt budget. After this many claims with no terminal ack the
// row is failed as undeliverable so a non-idempotent command cannot loop.
const MAX_DELIVERY_ATTEMPTS = 5;

/**
 * Hand the agent its deliverable commands (called by the agent's poll route).
 *
 * Returns the device's pending rows in queue order. A row whose delivery
 * window has closed is never handed out: if the agent never received it, it is
 * failed as expired; if it was handed out in time, it is left to its pending
 * ack. The first hand-out of a row stamps `deliveredAt`, which is how a watcher
 * tells "the node has it" apart from "still queued".
 */
export const takeDeliverableCommands = internalMutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const now = Date.now();
    const pending = await ctx.db
      .query("cmd_droneCommands")
      .withIndex("by_deviceId_status", (q) =>
        q.eq("deviceId", deviceId).eq("status", "pending")
      )
      .collect();

    const deliverable: Array<typeof pending[number]> = [];
    for (const row of pending) {
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
        if (row.deliveredAt === undefined) {
          await ctx.db.patch(row._id, {
            status: "failed",
            result: { success: false, message: EXPIRED_BEFORE_DELIVERY },
            completedAt: now,
          });
        }
        continue;
      }
      if (row.deliveredAt === undefined) {
        await ctx.db.patch(row._id, { deliveredAt: now });
        deliverable.push({ ...row, deliveredAt: now });
      } else {
        deliverable.push(row);
      }
    }
    return deliverable;
  },
});

/**
 * Claim a batch of commands for execution (called by the agent before it
 * runs them). Atomically leases each row by flipping pending → delivering
 * with a fresh `claimedAt` and an incremented `attempts`, then returns the
 * claimed set. The agent executes the returned commands and acks each to a
 * terminal status.
 *
 * Two reliability properties:
 *
 *  - A "delivering" row whose lease has expired (the agent crashed or lost
 *    the network between claim and ack) is reclaimable, so a command is not
 *    stranded forever. It is re-leased, not duplicated, because the row id is
 *    stable and only one claim window can hold a fresh lease at a time.
 *  - A row that has been claimed `MAX_DELIVERY_ATTEMPTS` times without a
 *    terminal ack is failed as undeliverable rather than re-leased, so a
 *    command the agent keeps failing to ack cannot loop indefinitely. This
 *    bounds the at-least-once window for non-idempotent commands.
 *
 * The Convex mutation runs in a single transaction, so two concurrent polls
 * for the same device serialize: the first claim flips the row out of the
 * claimable set the second one sees.
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

    // Reclaimable = a delivering row whose lease has expired. A row still
    // inside its lease window belongs to an in-flight agent run; leave it.
    const reclaimable = delivering.filter(
      (row) => (row.claimedAt ?? 0) + CLAIM_LEASE_MS <= now,
    );

    // Oldest first so a backlog drains in order; cap the batch.
    const candidates = [...pending, ...reclaimable]
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, MAX_DELIVERY_BATCH);

    const claimed: Array<typeof candidates[number]> = [];
    for (const row of candidates) {
      // A closed delivery window is final: the row is failed, never leased.
      if (row.expiresAt !== undefined && row.expiresAt <= now) {
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
      const nextAttempts = (row.attempts ?? 0) + 1;
      if (nextAttempts > MAX_DELIVERY_ATTEMPTS) {
        // Out of attempts: fail the row instead of re-leasing it so a
        // command the agent cannot ack does not re-execute forever.
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
      await ctx.db.patch(row._id, {
        status: "delivering",
        claimedAt: now,
        attempts: nextAttempts,
      });
      claimed.push({ ...row, status: "delivering", claimedAt: now, attempts: nextAttempts });
    }

    return claimed;
  },
});

/**
 * Acknowledge a command (called by agent via HTTP).
 */
export const ackCommand = internalMutation({
  args: {
    commandId: v.id("cmd_droneCommands"),
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

// Per-status delete cap per cron tick so a large backlog cannot exceed the
// per-call transaction limits; the hourly cron drains the rest over time.
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
  handler: async (ctx) => {
    const cutoff = Date.now() - COMMAND_RETENTION_MS;
    let deleted = 0;
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
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - COMMAND_STUCK_MS;
    let expired = 0;
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
    }
    return { expired };
  },
});
