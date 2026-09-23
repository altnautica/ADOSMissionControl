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

describe("takeDeliverableCommands", () => {
  const seed = () => {
    const ctx = makeCtx();
    const now = Date.now();
    const base = { deviceId: "dev-1", userId: "user-1", command: "send_command", status: "pending" };
    ctx.db.seed("cmd_droneCommands", [
      // Window closed and the agent never took it: must never run.
      { ...base, args: { cmd: "killSwitch" }, createdAt: now - 20_000, expiresAt: now - 10_000 },
      // Window closed, but the agent took it in time: its ack is pending.
      { ...base, args: { cmd: "land" }, createdAt: now - 20_000, expiresAt: now - 10_000, deliveredAt: now - 15_000 },
      // Window still open.
      { ...base, args: { cmd: "rtl" }, createdAt: now - 1_000, expiresAt: now + 9_000 },
      // No window at all.
      { ...base, command: "get_services", createdAt: now - 1_000 },
    ]);
    return ctx;
  };
  const cmdOf = (row: Row) => (row.args as { cmd?: string } | undefined)?.cmd ?? row.command;

  it("never hands out a row whose window closed before delivery, and fails it", async () => {
    const ctx = seed();
    const out = (await invoke(commands.takeDeliverableCommands, ctx, { deviceId: "dev-1" })) as Row[];

    expect(out.map(cmdOf)).toEqual(["rtl", "get_services"]);
    const kill = ctx.db.rows("cmd_droneCommands").find((r) => cmdOf(r) === "killSwitch");
    expect(kill?.status).toBe("failed");
    expect(kill?.result).toEqual({
      success: false,
      message: "command expired: not delivered to the node in time",
    });
    expect(typeof kill?.completedAt).toBe("number");
  });

  it("leaves a row delivered in time pending for its ack", async () => {
    const ctx = seed();
    await invoke(commands.takeDeliverableCommands, ctx, { deviceId: "dev-1" });
    const land = ctx.db.rows("cmd_droneCommands").find((r) => cmdOf(r) === "land");
    expect(land?.status).toBe("pending");
  });

  it("stamps the first hand-out so a watcher can tell delivered from queued", async () => {
    const ctx = seed();
    const before = Date.now();
    const out = (await invoke(commands.takeDeliverableCommands, ctx, { deviceId: "dev-1" })) as Row[];
    const rtl = out.find((r) => cmdOf(r) === "rtl");
    expect(rtl?.deliveredAt).toBeGreaterThanOrEqual(before);
    const stored = ctx.db.rows("cmd_droneCommands").find((r) => cmdOf(r) === "rtl");
    expect(stored?.deliveredAt).toBe(rtl?.deliveredAt);
  });
});
