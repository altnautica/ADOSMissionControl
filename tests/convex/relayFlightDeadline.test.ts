/**
 * A command that moves the vehicle is queued with a delivery deadline whoever
 * queues it. The GCS sends a short TTL; the MCP reach path and any hand-made
 * call send none, and before the deadline was enforced server-side such a row
 * took the queue's ten-minute default, so a takeoff queued while the node was
 * unreachable ran minutes later. Exercised against the real handlers.
 */
import { describe, expect, it } from "vitest";

import * as commands from "../../convex/cmdDroneCommands";
import * as reachDb from "../../convex/cmdMcpReachDb";
import { FLIGHT_COMMAND_TTL_MS } from "../../convex/commandVocabulary";
import { invoke, makeCtx } from "./fakeConvexCtx";

function ownedCtx(subject?: string) {
  const ctx = makeCtx(subject ? { subject } : {});
  ctx.db.seed("cmd_drones", [{ deviceId: "dev-1", userId: "user-1" }]);
  return ctx;
}

describe("flight command delivery deadline", () => {
  it("stamps the flight deadline on an MCP-queued control command", async () => {
    const ctx = ownedCtx();
    await invoke(reachDb.enqueueForUser, ctx, {
      userId: "user-1",
      deviceId: "dev-1",
      command: "send_command",
      args: { cmd: "takeoff", args: [10] },
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    expect((row.expiresAt as number) - (row.createdAt as number)).toBe(FLIGHT_COMMAND_TTL_MS);
  });

  it("stamps the flight deadline on a browser call that omits the TTL", async () => {
    const ctx = ownedCtx("user-1|session-1");
    await invoke(commands.enqueueCommand, ctx, {
      deviceId: "dev-1",
      command: "send_command",
      args: { cmd: "arm", args: [] },
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    expect((row.expiresAt as number) - (row.createdAt as number)).toBe(FLIGHT_COMMAND_TTL_MS);
  });

  it("leaves a non-flight MCP command on the queue's default window", async () => {
    const ctx = ownedCtx();
    await invoke(reachDb.enqueueForUser, ctx, {
      userId: "user-1",
      deviceId: "dev-1",
      command: "get_services",
    });
    expect(ctx.db.rows("cmd_droneCommands")[0]).not.toHaveProperty("expiresAt");
  });

  it("an MCP flight command past its deadline is failed, never handed out", async () => {
    const ctx = ownedCtx();
    await invoke(reachDb.enqueueForUser, ctx, {
      userId: "user-1",
      deviceId: "dev-1",
      command: "send_command",
      args: { cmd: "takeoff", args: [10] },
    });
    const row = ctx.db.rows("cmd_droneCommands")[0];
    // The node comes back a minute later.
    row.createdAt = (row.createdAt as number) - 60_000;
    row.expiresAt = (row.expiresAt as number) - 60_000;
    const claimed = await invoke(commands.claimCommands, ctx, { deviceId: "dev-1" });
    expect(claimed).toEqual([]);
    expect(ctx.db.rows("cmd_droneCommands")[0].status).toBe("failed");
  });
});
