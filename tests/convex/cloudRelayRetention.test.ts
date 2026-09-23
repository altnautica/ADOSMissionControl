/**
 * Contract tests for the cloud-relay retention + hygiene surface.
 *
 * Pins the security/perf fixes that are pure source-shape invariants:
 *   - cleanExpiredRequests is cron-only (internalMutation) and walks an index
 *     instead of a full-table .filter().collect().
 *   - terminal command rows + exported log windows have a retention sweep
 *     wired into the cron schedule.
 *   - storage has no generic getUrl resolver that mints a signed URL for any
 *     blob to any authenticated user.
 *
 * The sweeps added for the append-only tables are exercised behaviourally
 * against their real handlers at the bottom of the file: a retention rule is a
 * cutoff and a bound, and neither is visible in a source-shape assertion.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as commands from "../../convex/cmdDroneCommands";
import * as drones from "../../convex/cmdDrones";
import * as mcpTokens from "../../convex/cmdMcpTokens";
import * as aiUsage from "../../convex/cmdAiUsage";
import * as pairing from "../../convex/cmdPairing";
import * as plugins from "../../convex/cmdPlugins";
import { invoke, makeCtx } from "./fakeConvexCtx";

const read = (rel: string) =>
  readFile(path.join(process.cwd(), rel), "utf8");

const DAY_MS = 24 * 60 * 60 * 1000;

describe("expired-pairing cleanup is cron-only + indexed", () => {
  it("declares cleanExpiredRequests as an internalMutation", async () => {
    const text = await read("convex/cmdPairing.ts");
    expect(text).toContain("export const cleanExpiredRequests = internalMutation");
    // The public mutation form is gone (no client can trigger the scan).
    expect(text).not.toContain("export const cleanExpiredRequests = mutation");
  });

  it("walks the by_expiresAt index instead of a full-table filter scan", async () => {
    const text = await read("convex/cmdPairing.ts");
    expect(text).toContain('withIndex("by_expiresAt"');
    expect(text).not.toContain('.filter((q) => q.lt(q.field("expiresAt"), now))');
  });

  it("is invoked through the internal API from the cron", async () => {
    const crons = await read("convex/crons.ts");
    expect(crons).toContain("internal.cmdPairing.cleanExpiredRequests");
    expect(crons).not.toContain("api.cmdPairing.cleanExpiredRequests");
  });
});

describe("retention sweeps for append-mostly tables", () => {
  it("prunes terminal command rows on an indexed range", async () => {
    const [commands, crons, schema] = await Promise.all([
      read("convex/cmdDroneCommands.ts"),
      read("convex/crons.ts"),
      read("convex/schema.ts"),
    ]);
    expect(commands).toContain("export const pruneTerminalCommands = internalMutation");
    expect(commands).toContain('withIndex("by_status_completedAt"');
    expect(schema).toContain('.index("by_status_completedAt", ["status", "completedAt"])');
    expect(crons).toContain("internal.cmdDroneCommands.pruneTerminalCommands");
  });

  it("prunes old exported log windows + deletes their blobs", async () => {
    const [windows, crons, schema] = await Promise.all([
      read("convex/cmdLogdWindows.ts"),
      read("convex/crons.ts"),
      read("convex/schema.ts"),
    ]);
    expect(windows).toContain("export const pruneOldWindows = internalMutation");
    expect(windows).toContain('withIndex("by_pushedAt"');
    // The sweep must drop the storage blob so it never orphans storage.
    expect(windows).toContain("ctx.storage.delete(row.storageId)");
    expect(schema).toContain('.index("by_pushedAt", ["pushedAt"])');
    expect(crons).toContain("internal.cmdLogdWindows.pruneOldWindows");
  });

  it("bounds the windows list query instead of an unbounded collect", async () => {
    const text = await read("convex/cmdLogdWindows.ts");
    // getLogdWindows must .take a bounded set, not .collect the whole table.
    const listSlice = text.slice(text.indexOf("export const getLogdWindows"));
    const handlerEnd = listSlice.indexOf("export const getWindowInternal");
    const listBody = listSlice.slice(0, handlerEnd);
    expect(listBody).toContain(".take(MAX_WINDOW_LIST)");
    expect(listBody).not.toContain(".collect()");
  });
});

describe("storage has no over-permissive generic resolver", () => {
  it("does not export a public getUrl that resolves any storageId", async () => {
    const text = await read("convex/storage.ts");
    expect(text).not.toContain("export const getUrl");
    // generateUploadUrl stays (admin-gated).
    expect(text).toContain("export const generateUploadUrl = mutation");
  });
});

describe("stuck commands are expired, not left pending forever", () => {
  const seedCommands = () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed("cmd_droneCommands", [
      // Queued two hours ago and never delivered.
      { deviceId: "dev-1", userId: "u", command: "service_restart", status: "pending", createdAt: now - 2 * 60 * 60 * 1000 },
      // Claimed two hours ago and never acked.
      { deviceId: "dev-1", userId: "u", command: "wfb_pair_apply", status: "delivering", createdAt: now - 2 * 60 * 60 * 1000, claimedAt: now - 2 * 60 * 60 * 1000, attempts: 1 },
      // Queued a minute ago: the node is simply between polls.
      { deviceId: "dev-1", userId: "u", command: "reboot", status: "pending", createdAt: now - 60_000 },
      // Already terminal: the other sweep owns this one.
      { deviceId: "dev-1", userId: "u", command: "reboot", status: "completed", createdAt: now - 3 * 60 * 60 * 1000, completedAt: now - 3 * 60 * 60 * 1000 },
    ]);
    return ctx;
  };

  it("fails a command the node never picked up and says why", async () => {
    const ctx = seedCommands();

    const result = await invoke(commands.expireStuckCommands, ctx);

    expect(result).toEqual({ expired: 2 });
    const rows = ctx.db.rows("cmd_droneCommands");
    const restart = rows.find((r) => r.command === "service_restart");
    expect(restart?.status).toBe("failed");
    // The operator's command list has to account for the row, not lose it: a
    // non-idempotent action that silently vanished is indistinguishable from
    // one that ran.
    expect(restart?.result).toEqual({
      success: false,
      message: "command expired: never delivered to the node",
    });
    // Stamped terminal so the 7-day sweep is what finally frees the space.
    expect(typeof restart?.completedAt).toBe("number");

    const claimed = rows.find((r) => r.command === "wfb_pair_apply");
    expect(claimed?.status).toBe("failed");
    expect(claimed?.result).toEqual({
      success: false,
      message: "command expired: claimed by the node but never acknowledged",
    });
  });

  it("leaves a fresh command and an already-terminal row alone", async () => {
    const ctx = seedCommands();

    await invoke(commands.expireStuckCommands, ctx);

    const rows = ctx.db.rows("cmd_droneCommands");
    expect(rows.filter((r) => r.status === "pending")).toHaveLength(1);
    expect(rows.find((r) => r.status === "pending")?.command).toBe("reboot");
    expect(rows.filter((r) => r.status === "completed")).toHaveLength(1);
  });
});

describe("the append-only event tables are swept", () => {
  it("deletes plugin events past 30 days and keeps the rest", async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed("cmd_pluginEvents", [
      { userId: "u", pluginInstallId: "i", pluginId: "p", type: "started", severity: "info", message: "old", createdAt: now - 31 * DAY_MS },
      { userId: "u", pluginInstallId: "i", pluginId: "p", type: "crashed", severity: "error", message: "recent", createdAt: now - 29 * DAY_MS },
    ]);

    const result = await invoke(plugins.pruneOldEvents, ctx);

    expect(result).toEqual({ deleted: 1 });
    expect(ctx.db.rows("cmd_pluginEvents").map((r) => r.message)).toEqual(["recent"]);
  });

  it("deletes MCP audit rows past 30 days and keeps the rest", async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed("cmd_mcpAuditEvents", [
      { userId: "u", tokenId: "t", tool: "flight.arm", node: "dev-1", decision: "denied", result: "old", plane: "cloud_relay", latencyMs: 1, tsUs: 1, contentHash: "a", createdAt: now - 31 * DAY_MS },
      { userId: "u", tokenId: "t", tool: "flight.arm", node: "dev-1", decision: "allowed", result: "recent", plane: "cloud_relay", latencyMs: 1, tsUs: 2, contentHash: "b", createdAt: now - 1 * DAY_MS },
    ]);

    const result = await invoke(mcpTokens.pruneOldAuditEvents, ctx);

    expect(result).toEqual({ deleted: 1 });
    expect(ctx.db.rows("cmd_mcpAuditEvents").map((r) => r.result)).toEqual(["recent"]);
  });

  it("keeps draining while a sweep deleted a full batch", async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed(
      "cmd_mcpAuditEvents",
      Array.from({ length: 300 }, (_, i) => ({
        userId: "u", tokenId: "t", tool: "flight.arm", node: "dev-1", decision: "allowed",
        result: `r${i}`, plane: "cloud_relay", latencyMs: 1, tsUs: i, contentHash: `h${i}`,
        createdAt: now - 40 * DAY_MS,
      })),
    );
    await invoke(mcpTokens.pruneOldAuditEvents, ctx);
    expect(ctx.scheduled).toHaveLength(1);

    const small = makeCtx();
    small.db.seed("cmd_pluginEvents", [
      { userId: "u", pluginInstallId: "i", pluginId: "p", type: "started", severity: "info", message: "old", createdAt: now - 31 * DAY_MS },
    ]);
    await invoke(plugins.pruneOldEvents, small);
    expect(small.scheduled).toHaveLength(0);
  });

  it("wires both sweeps into the cron schedule as internal functions", async () => {
    const crons = await read("convex/crons.ts");
    expect(crons).toContain("internal.cmdPlugins.pruneOldEvents");
    expect(crons).toContain("internal.cmdMcpTokens.pruneOldAuditEvents");
    expect(crons).toContain("internal.cmdDroneCommands.expireStuckCommands");
    expect(crons).not.toContain("api.cmdPlugins.pruneOldEvents");
  });
});

describe("usage and security sweeps", () => {
  it("keeps every usage row a weekly quota can still count", async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed("cmd_ai_usage", [
      { userId: "u", feature: "pid_analysis", usedAt: now - 9 * DAY_MS },
      { userId: "u", feature: "pid_analysis", usedAt: now - 7 * DAY_MS },
    ]);

    const result = await invoke(aiUsage.pruneOldUsage, ctx);

    expect(result).toEqual({ deleted: 1 });
    expect(ctx.db.rows("cmd_ai_usage").map((r) => r.usedAt)).toEqual([now - 7 * DAY_MS]);
  });

  it("drains a full batch of terminal commands but never spins on locked buckets", async () => {
    const ctx = makeCtx();
    const now = Date.now();
    ctx.db.seed(
      "cmd_droneCommands",
      Array.from({ length: 300 }, () => ({
        deviceId: "d", userId: "u", command: "reboot", status: "completed",
        createdAt: now - 10 * DAY_MS, completedAt: now - 10 * DAY_MS,
      })),
    );
    await invoke(commands.pruneTerminalCommands, ctx);
    expect(ctx.scheduled).toHaveLength(1);

    const locked = makeCtx();
    locked.db.seed(
      "cmd_authAttempts",
      Array.from({ length: 256 }, (_, i) => ({
        key: `k${i}`, attempts: 9, firstAttemptAt: now - 2 * DAY_MS,
        lastAttemptAt: now - 2 * DAY_MS, lockedUntil: now + 60_000,
      })),
    );
    await invoke(pairing.cleanExpiredSecurityState, locked);
    expect(locked.scheduled).toHaveLength(0);
  });
});

describe("unpairing a drone takes its data with it", () => {
  it("runs the device wipe instead of deleting the pairing row alone", async () => {
    const wiped: unknown[] = [];
    const ctx = makeCtx({
      subject: "user-1|s",
      run: async (_ref, args) => {
        wiped.push(args);
        return { removedDrones: 1 };
      },
    });
    const [row] = ctx.db.seed("cmd_drones", [
      { userId: "user-1", deviceId: "dev-1", name: "drone", apiKey: "k", pairedAt: Date.now() },
    ]);

    await invoke(drones.unpairDrone, ctx, { droneId: row._id });

    // The cascade owns every keyed table; unpair must not hand-roll a subset.
    expect(wiped).toEqual([{ deviceIds: ["dev-1"] }]);
  });

  it("refuses a drone owned by another account and wipes nothing", async () => {
    const wiped: unknown[] = [];
    const ctx = makeCtx({
      subject: "user-B|s",
      run: async (_ref, args) => {
        wiped.push(args);
        return {};
      },
    });
    const [row] = ctx.db.seed("cmd_drones", [
      { userId: "owner-A", deviceId: "dev-1", name: "drone", apiKey: "k", pairedAt: Date.now() },
    ]);

    await expect(
      invoke(drones.unpairDrone, ctx, { droneId: row._id }),
    ).rejects.toThrow(/Not found/);
    expect(wiped).toEqual([]);
    expect(ctx.db.rows("cmd_drones")).toHaveLength(1);
  });
});
