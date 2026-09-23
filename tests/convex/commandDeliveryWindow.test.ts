/**
 * A queued command with a delivery window is handed to the agent only while
 * that window is open. A flight command queued while the node was unreachable
 * must never execute when the node comes back, so the poll fails an expired,
 * never-delivered row instead of returning it. Exercised against the real
 * handlers through the in-memory ctx.
 */
import { describe, expect, it } from "vitest";

import * as commands from "../../convex/cmdDroneCommands";
import { invoke, makeCtx } from "./fakeConvexCtx";

type Row = Record<string, unknown>;

describe("enqueueCommand delivery window", () => {
  const ownedCtx = () => {
    const ctx = makeCtx({ subject: "user-1|session-1" });
    ctx.db.seed("cmd_drones", [{ deviceId: "dev-1", userId: "user-1" }]);
    return ctx;
  };

  it("stamps a server-clock expiry from the requested TTL", async () => {
    const ctx = ownedCtx();
    const before = Date.now();
    await invoke(commands.enqueueCommand, ctx, {
      deviceId: "dev-1",
      command: "send_command",
      args: { cmd: "rtl", args: [] },
      ttlMs: 10_000,
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    expect(row.expiresAt).toBeGreaterThanOrEqual(before + 10_000);
    expect(row.expiresAt).toBeLessThanOrEqual(Date.now() + 10_000);
  });

  it("caps an oversized TTL so a command cannot wait indefinitely", async () => {
    const ctx = ownedCtx();
    await invoke(commands.enqueueCommand, ctx, {
      deviceId: "dev-1",
      command: "send_command",
      args: { cmd: "arm", args: [] },
      ttlMs: 24 * 60 * 60 * 1000,
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    expect((row.expiresAt as number) - (row.createdAt as number)).toBe(60_000);
  });

  it("leaves a command queued without a TTL open-ended", async () => {
    const ctx = ownedCtx();
    await invoke(commands.enqueueCommand, ctx, {
      deviceId: "dev-1",
      command: "get_services",
    });
    expect(ctx.db.rows("cmd_droneCommands")[0]).not.toHaveProperty("expiresAt");
  });
});

describe("claimCommands", () => {
  const seed = () => {
    const ctx = makeCtx();
    const now = Date.now();
    const base = { deviceId: "dev-1", userId: "user-1", command: "send_command", status: "pending" };
    ctx.db.seed("cmd_droneCommands", [
      // Window closed and the agent never took it: must never run.
      { ...base, args: { cmd: "killSwitch" }, createdAt: now - 20_000, expiresAt: now - 10_000 },
      // Window closed, but the agent took it in time and holds the lease.
      {
        ...base,
        args: { cmd: "land" },
        status: "delivering",
        createdAt: now - 20_000,
        expiresAt: now - 10_000,
        deliveredAt: now - 15_000,
        claimedAt: now - 15_000,
        attempts: 1,
      },
      // Window still open.
      { ...base, args: { cmd: "rtl" }, createdAt: now - 1_000, expiresAt: now + 9_000 },
      // No explicit window, queued recently.
      { ...base, command: "get_services", createdAt: now - 1_000 },
    ]);
    return ctx;
  };
  const cmdOf = (row: Row) => (row.args as { cmd?: string } | undefined)?.cmd ?? row.command;
  const find = (ctx: ReturnType<typeof makeCtx>, cmd: string) =>
    ctx.db.rows("cmd_droneCommands").find((r) => cmdOf(r) === cmd);

  it("never hands out a row whose window closed before delivery, and fails it", async () => {
    const ctx = seed();
    const out = (await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" })) as Row[];

    expect(out.map(cmdOf)).toEqual(["rtl", "get_services"]);
    const kill = find(ctx, "killSwitch");
    expect(kill?.status).toBe("failed");
    expect(kill?.result).toEqual({
      success: false,
      message: "command expired: not delivered to the node in time",
    });
    expect(typeof kill?.completedAt).toBe("number");
  });

  it("leaves a row still inside its lease to its pending ack", async () => {
    const ctx = seed();
    await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" });
    expect(find(ctx, "land")?.status).toBe("delivering");
  });

  it("stamps the first hand-out so a watcher can tell delivered from queued", async () => {
    const ctx = seed();
    const before = Date.now();
    const out = (await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" })) as Row[];
    const rtl = out.find((r) => cmdOf(r) === "rtl");
    expect(rtl?.deliveredAt).toBeGreaterThanOrEqual(before);
    expect(find(ctx, "rtl")?.deliveredAt).toBe(rtl?.deliveredAt);
  });

  it("does not hand a claimed row out again on the next poll", async () => {
    const ctx = seed();
    await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" });
    const again = (await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" })) as Row[];
    expect(again).toEqual([]);
  });

  it("fails a row queued without a TTL once the default delivery window passed", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_droneCommands", [
      {
        deviceId: "dev-1",
        userId: "user-1",
        command: "restart_service",
        status: "pending",
        createdAt: Date.now() - 90 * 60 * 1000,
      },
    ]);
    const out = (await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" })) as Row[];
    expect(out).toEqual([]);
    expect(ctx.db.rows("cmd_droneCommands")[0].status).toBe("failed");
  });
});

describe("ackCommand", () => {
  const seedRow = (status: string, result?: Row) => {
    const ctx = makeCtx();
    const [row] = ctx.db.seed("cmd_droneCommands", [
      {
        deviceId: "dev-1",
        userId: "user-1",
        command: "wfb_pair_apply",
        status,
        createdAt: Date.now(),
        ...(result ? { result } : {}),
      },
    ]);
    return { ctx, id: row._id };
  };

  it("records the verdict of a row awaiting it", async () => {
    const { ctx, id } = seedRow("delivering");
    await invoke(commands.ackCommand, ctx, { commandId: id, deviceId: "dev-1", status: "completed" });
    expect(ctx.db.rows("cmd_droneCommands")[0].status).toBe("completed");
  });

  it("never overwrites a terminal verdict with a late ack", async () => {
    const cancelled = { success: false, message: "cancelled by GCS" };
    const { ctx, id } = seedRow("failed", cancelled);
    await invoke(commands.ackCommand, ctx, {
      commandId: id,
      deviceId: "dev-1",
      status: "completed",
      result: { success: true, message: "ok" },
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    expect(row.status).toBe("failed");
    expect(row.result).toEqual(cancelled);
  });
});
