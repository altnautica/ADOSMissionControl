/**
 * @module cmdPluginInstallJobs
 * @description Cloud-relay install job state machine for the
 * per-drone plugin install flow.
 *
 * Each job is scoped to a single (operator, drone, plugin) install
 * and carries the GCS to cloud to agent request through a six-stage
 * state machine:
 *
 *   queued  →  commanded  →  downloading  →  verifying
 *           →  installing  →  completed
 *   any step may transition to `failed` or `cancelled`.
 *
 * `createJob` is the operator-facing entry point. It:
 *   1. Verifies the caller owns both the archive and the target drone.
 *   2. Resolves a short-lived signed download URL for the archive
 *      blob (5-minute hard ceiling, enforced via the embedded
 *      `signedUrlExpiresAt` field that the agent must respect).
 *   3. Enqueues a `plugin.install` command on `cmd_droneCommands`
 *      with the URL, sha256, declared permissions, and the job id
 *      for back-correlation.
 *   4. Patches the job to `commanded` and links the command id.
 *
 * `settleInstallJobFromAck` is the agent-facing transition. The command
 * ACK mutation (`cmdDroneCommands.ackCommand`) runs it in the same
 * transaction that records the ack, so the job reaches `completed` or
 * `failed` exactly when its `plugin.install` command does.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { requireOwnedDroneByDeviceId } from "./cmdDroneAccess";
import type { Doc, Id } from "./_generated/dataModel";

/** Hard ceiling on how long the agent has to fetch the archive blob. */
const SIGNED_URL_TTL_MS = 5 * 60 * 1000;

// ──────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────

/**
 * Operator creates an install job for `archiveId` targeting
 * `deviceId`. Enqueues the corresponding `plugin.install` command
 * and links it back to the job in a single transaction.
 */
export const createJob = mutation({
  args: {
    deviceId: v.string(),
    archiveId: v.id("plugin_archives"),
    requestedPermissions: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"plugin_install_jobs">> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    // Verify ownership: drone + archive must both belong to caller.
    await requireOwnedDroneByDeviceId(ctx, args.deviceId);
    const archive = await ctx.db.get(args.archiveId);
    if (!archive || archive.userId !== userId) {
      throw new Error("Archive not found");
    }

    // Defend the permission scope: every requested permission must
    // appear in the manifest. Required permissions are auto-included
    // so the operator cannot accidentally narrow below the contract.
    const declaredIds = new Set(
      archive.declaredPermissions.map((p) => p.id),
    );
    for (const reqId of args.requestedPermissions) {
      if (!declaredIds.has(reqId)) {
        throw new Error(
          `Requested permission ${reqId} was not declared in the manifest`,
        );
      }
    }
    const effectivePermissions = Array.from(
      new Set([
        ...args.requestedPermissions,
        ...archive.declaredPermissions
          .filter((p) => p.required)
          .map((p) => p.id),
      ]),
    );

    const now = Date.now();
    const jobId: Id<"plugin_install_jobs"> = await ctx.db.insert(
      "plugin_install_jobs",
      {
        userId,
        operatorId: userId,
        deviceId: args.deviceId,
        archiveId: args.archiveId,
        pluginId: archive.pluginId,
        version: archive.version,
        requestedPermissions: effectivePermissions,
        stage: "queued",
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      },
    );

    // Resolve the signed URL inline (mutations can call
    // `ctx.storage.getUrl` directly, no action hop needed). The
    // embedded `signedUrlExpiresAt` field bounds the surface to
    // the configured TTL even when the underlying Convex storage
    // URL is valid for longer.
    const signedUrl = await ctx.storage.getUrl(archive.storageId);
    if (!signedUrl) {
      throw new Error("Archive blob missing in storage");
    }
    const signedUrlExpiresAt = now + SIGNED_URL_TTL_MS;

    const cmdId: Id<"cmd_droneCommands"> = await ctx.db.insert(
      "cmd_droneCommands",
      {
        deviceId: args.deviceId,
        userId,
        command: "plugin.install",
        args: {
          jobId,
          archiveId: args.archiveId,
          signedUrl,
          signedUrlExpiresAt,
          requestedPermissions: effectivePermissions,
          pluginId: archive.pluginId,
          version: archive.version,
          archiveSha256: archive.sha256,
          manifestHash: archive.manifestHash,
          signerId: archive.signerId,
          signatureB64: archive.signatureB64,
        },
        status: "pending",
        createdAt: now,
      },
    );

    await ctx.db.patch(jobId, {
      cmdId,
      stage: "commanded",
      updatedAt: Date.now(),
    });

    // Bump archive refCount so a later cleanup pass can tell the
    // blob is still in use.
    await ctx.db.patch(args.archiveId, {
      refCount: archive.refCount + 1,
    });

    return jobId;
  },
});

/** The terminal outcome the agent reported for a command. */
export interface CommandAck {
  status: "completed" | "failed";
  result?: { success: boolean; message: string };
  data?: unknown;
}

/**
 * Settle the install job a `plugin.install` command was queued for, from the
 * agent's ACK of that command. Any other command, a row whose `args.jobId` is
 * not a job id, or a job not linked to this command row is left alone, so an
 * ack can only move the job its own command belongs to. A job already
 * completed, failed or cancelled keeps its stage: a cancel the operator made
 * while the command was in flight is not overwritten.
 *
 * `completed` records `data.installId` when it names a `cmd_pluginInstalls`
 * row. `failed` records `data.code` (default `install_failed`) and the result
 * message as the job error.
 */
export async function settleInstallJobFromAck(
  ctx: Pick<MutationCtx, "db">,
  command: Doc<"cmd_droneCommands">,
  ack: CommandAck,
): Promise<void> {
  if (command.command !== "plugin.install") return;
  const rawJobId = (command.args as { jobId?: unknown } | null | undefined)?.jobId;
  if (typeof rawJobId !== "string") return;
  const jobId = ctx.db.normalizeId("plugin_install_jobs", rawJobId);
  if (jobId === null) return;
  const job = await ctx.db.get(jobId);
  if (!job || job.cmdId !== command._id) return;
  if (job.stage === "completed" || job.stage === "failed" || job.stage === "cancelled") return;

  const data = ack.data as { installId?: unknown; code?: unknown } | null | undefined;
  const now = Date.now();
  if (ack.status === "completed") {
    const installId =
      typeof data?.installId === "string"
        ? ctx.db.normalizeId("cmd_pluginInstalls", data.installId)
        : null;
    await ctx.db.patch(jobId, {
      stage: "completed",
      updatedAt: now,
      ...(installId !== null ? { installId } : {}),
    });
    return;
  }
  await ctx.db.patch(jobId, {
    stage: "failed",
    updatedAt: now,
    error: {
      code: typeof data?.code === "string" ? data.code : "install_failed",
      message: ack.result?.message ?? "install failed on the drone",
    },
  });
}

/**
 * Operator cancels a job that has not yet reached `installing`.
 * Cancellation past `installing` is a no-op on the cloud side —
 * the agent has already started writing files and the operator
 * should `remove` the resulting install instead.
 */
export const cancelJob = mutation({
  args: { jobId: v.id("plugin_install_jobs") },
  handler: async (ctx, { jobId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== userId) {
      throw new Error("Job not found");
    }
    if (job.stage === "completed" || job.stage === "cancelled") return;
    if (job.stage === "installing") {
      throw new Error(
        "Job is already installing; remove the plugin from the drone instead",
      );
    }
    await ctx.db.patch(jobId, {
      stage: "cancelled",
      updatedAt: Date.now(),
    });
  },
});

// ──────────────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────────────

/** List jobs for one drone, scoped to the authenticated user. */
export const listJobsForDevice = query({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }): Promise<Doc<"plugin_install_jobs">[]> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("plugin_install_jobs")
      .withIndex("by_device_stage", (q) => q.eq("deviceId", deviceId))
      .collect();
    return rows
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  },
});

/** Read one job by id, scoped to the authenticated user. */
export const getJob = query({
  args: { jobId: v.id("plugin_install_jobs") },
  handler: async (
    ctx,
    { jobId },
  ): Promise<Doc<"plugin_install_jobs"> | null> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const row = await ctx.db.get(jobId);
    if (!row || row.userId !== userId) return null;
    return row;
  },
});
