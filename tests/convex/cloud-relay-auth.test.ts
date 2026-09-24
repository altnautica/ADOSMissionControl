import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: authMocks.getAuthUserId,
}));

import {
  requireCommandForDevice,
  requireOwnedCommand,
  requireOwnedDroneByDeviceId,
} from "../../convex/cmdDroneAccess";
import { isPublic } from "./fakeConvexCtx";

type Row = Record<string, unknown>;

function makeCtx(options: {
  userId: string | null;
  drones?: Row[];
  commands?: Row[];
}) {
  authMocks.getAuthUserId.mockResolvedValue(options.userId);
  const rowsByTable: Record<string, Row[]> = {
    cmd_drones: options.drones ?? [],
    cmd_droneCommands: options.commands ?? [],
  };

  return {
    db: {
      get: vi.fn(async (id: string) =>
        (options.commands ?? []).find((row) => row._id === id) ?? null
      ),
      query: vi.fn((table: string) => ({
        withIndex: (_index: string, apply: (q: unknown) => unknown) => {
          const filters: Array<[string, unknown]> = [];
          const q = {
            eq(field: string, value: unknown) {
              filters.push([field, value]);
              return q;
            },
          };
          apply(q);
          const rows = (rowsByTable[table] ?? []).filter((row) =>
            filters.every(([field, value]) => row[field] === value),
          );
          return {
            first: vi.fn(async () => rows[0] ?? null),
            collect: vi.fn(async () => rows),
          };
        },
      })),
    },
  };
}

describe("cloud relay authorization helpers", () => {
  it("allows an authenticated owner to access their paired device", async () => {
    const ctx = makeCtx({
      userId: "user-a",
      drones: [{ _id: "drone-a", userId: "user-a", deviceId: "device-a" }],
    });

    await expect(
      requireOwnedDroneByDeviceId(ctx as never, "device-a"),
    ).resolves.toMatchObject({ _id: "drone-a" });
  });

  it("rejects unauthenticated and cross-user device access", async () => {
    await expect(
      requireOwnedDroneByDeviceId(
        makeCtx({
          userId: null,
          drones: [{ userId: "user-a", deviceId: "device-a" }],
        }) as never,
        "device-a",
      ),
    ).rejects.toThrow("Not authenticated");

    await expect(
      requireOwnedDroneByDeviceId(
        makeCtx({
          userId: "user-b",
          drones: [{ userId: "user-a", deviceId: "device-a" }],
        }) as never,
        "device-a",
      ),
    ).rejects.toThrow("Not found");
  });

  it("requires command ownership and matching paired-device ownership", async () => {
    const command = {
      _id: "command-a",
      userId: "user-a",
      deviceId: "device-a",
      command: "arm",
      status: "pending",
    };

    await expect(
      requireOwnedCommand(
        makeCtx({
          userId: "user-a",
          drones: [{ userId: "user-a", deviceId: "device-a" }],
          commands: [command],
        }) as never,
        "command-a" as never,
      ),
    ).resolves.toMatchObject(command);

    await expect(
      requireOwnedCommand(
        makeCtx({
          userId: "user-a",
          drones: [{ userId: "user-b", deviceId: "device-a" }],
          commands: [command],
        }) as never,
        "command-a" as never,
      ),
    ).rejects.toThrow("Not found");
  });

  it("prevents an agent from acknowledging another device command", async () => {
    const ctx = makeCtx({
      userId: null,
      commands: [{ _id: "command-a", deviceId: "device-a" }],
    });

    await expect(
      requireCommandForDevice(ctx as never, "command-a" as never, "device-a"),
    ).resolves.toMatchObject({ _id: "command-a" });
    await expect(
      requireCommandForDevice(ctx as never, "command-a" as never, "device-b"),
    ).rejects.toThrow("Not found");
  });

  it("blocks a non-owner from reading another user's command", async () => {
    // Client-callable command reads authenticate the caller via
    // requireOwnedCommand (owner-bound), not the agent-facing
    // requireCommandForDevice (deviceId-only). Prove the owner-bound helper
    // rejects a signed-in user who supplies a victim's commandId.
    const victimCommand = {
      _id: "command-victim",
      userId: "user-victim",
      deviceId: "device-victim",
      command: "wfb_pair_init_remote",
      status: "pending",
    };

    await expect(
      requireOwnedCommand(
        makeCtx({
          userId: "user-attacker",
          drones: [{ userId: "user-victim", deviceId: "device-victim" }],
          commands: [victimCommand],
        }) as never,
        "command-victim" as never,
      ),
    ).rejects.toThrow("Not found");
  });

  it("still admits the owner of a row written before the userId migration", async () => {
    // Command rows carry one of two spellings of the same principal: the bare
    // id, and the older compound "userId|sessionId" subject. Comparing only the
    // bare form would tell an operator "Not found" for a command they queued
    // themselves, and nothing prunes a pending row, so it would never clear.
    const legacy = {
      _id: "command-legacy",
      userId: "user-a|session-xyz",
      deviceId: "device-a",
      command: "wfb_pair_init_remote",
      status: "pending",
    };

    await expect(
      requireOwnedCommand(
        makeCtx({
          userId: "user-a",
          drones: [{ _id: "drone-a", userId: "user-a", deviceId: "device-a" }],
          commands: [legacy],
        }) as never,
        "command-legacy" as never,
      ),
    ).resolves.toMatchObject({ _id: "command-legacy" });

    // The prefix must not become a wildcard: "user-a10" is a different account
    // whose id merely starts with this one.
    await expect(
      requireOwnedCommand(
        makeCtx({
          userId: "user-a",
          drones: [{ _id: "drone-a", userId: "user-a", deviceId: "device-a" }],
          commands: [{ ...legacy, _id: "command-other", userId: "user-a10" }],
        }) as never,
        "command-other" as never,
      ),
    ).rejects.toThrow("Not found");
  });

  it("keeps agent-only relay functions out of the public Convex API", async () => {
    const [commands, status, drones] = await Promise.all([
      import("../../convex/cmdDroneCommands"),
      import("../../convex/cmdDroneStatus"),
      import("../../convex/cmdDrones"),
    ]);
    for (const fn of [
      commands.claimCommands,
      commands.ackCommand,
      status.pushStatus,
      drones.getDroneByDeviceId,
    ]) {
      expect(isPublic(fn)).toBe(false);
    }
  });
});
