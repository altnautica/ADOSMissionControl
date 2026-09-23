/**
 * The pairing state machine, exercised against the REAL exported handlers.
 *
 * This file used to do two things, both weak. It asserted on the SOURCE TEXT of
 * `convex/cmdPairing.ts` (`expect(text).toContain("if (request.expiresAt < Date.now()) {")`),
 * which fails on a rename and passes on a behavioural regression; and it
 * re-implemented each handler against a hand-written fake store, so it verified
 * the copy rather than the code — the two could drift silently, and did.
 *
 * Both are replaced by invoking `._handler` with the in-memory ctx in
 * `fakeConvexCtx`. Every intent the old file expressed is preserved below;
 * exposure, credential leakage and rate limiting live in
 * `anonymousExposure.test.ts`.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as pairing from "../../convex/cmdPairing";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const NOW = Date.now();
const CODE_TTL_MS = 15 * 60 * 1000;
const LIVE = NOW + CODE_TTL_MS;

/** Mint a session and return both its secret and the owner marker it derives. */
async function session(ctx: FakeCtx): Promise<{ secret: string; marker: string }> {
  const before = ctx.db.rows("cmd_browserSessions").length;
  const out = await invoke(pairing.issueBrowserSession, ctx);
  const row = ctx.db.rows("cmd_browserSessions")[before];
  return {
    secret: (out as { browserSessionSecret: string }).browserSessionSecret,
    marker: `browser:${row._id}`,
  };
}

function request(ctx: FakeCtx, overrides: Record<string, unknown> = {}) {
  return ctx.db.seed("cmd_pairingRequests", [
    { pairingCode: "ABC234", expiresAt: LIVE, ...overrides },
  ])[0];
}

function drone(ctx: FakeCtx, overrides: Record<string, unknown>) {
  return ctx.db.seed("cmd_drones", [
    {
      userId: "owner",
      deviceId: "dev-1",
      name: "drone",
      apiKey: "old-key",
      lastSeen: NOW,
      fcConnected: false,
      pairedAt: NOW,
      ...overrides,
    },
  ])[0];
}

describe("pairing-code normalisation", () => {
  it("uppercases and accepts a valid six-char safe code", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1", apiKey: "key-1" });
    const result = await invoke(pairing.claimPairingCode, ctx, { code: "  abc234 " });
    expect((result as { error: string | null }).error).toBeNull();
  });

  it("rejects codes containing the ambiguous excluded characters (0, 1, I, O)", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    for (const bad of ["ABC2I4", "ABC2O4", "ABC201", "ABCDE1"]) {
      await expect(
        invoke(pairing.claimPairingCode, ctx, { code: bad }),
      ).rejects.toThrow(/six safe uppercase characters/);
    }
  });

  it("rejects wrong-length codes", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    for (const bad of ["ABC23", "ABC2345"]) {
      await expect(
        invoke(pairing.claimPairingCode, ctx, { code: bad }),
      ).rejects.toThrow(/six safe uppercase characters/);
    }
  });
});

describe("claimPairingCode (signed in)", () => {
  it("claims a fresh code, marks it claimed, and creates the drone row", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1", apiKey: "key-1" });

    const result = await invoke(pairing.claimPairingCode, ctx, { code: "abc234" });
    expect(result).toMatchObject({ error: null, deviceId: "dev-1", apiKey: "key-1" });
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBe("user-1");
    expect(ctx.db.rows("cmd_drones")).toHaveLength(1);
  });

  it("returns invalid_pairing_code for an unknown code", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    expect(await invoke(pairing.claimPairingCode, ctx, { code: "ZZZ999" })).toEqual({
      error: "invalid_pairing_code",
    });
  });

  it("returns pairing_code_expired and deletes the stale row when past TTL", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1", apiKey: "key-1", expiresAt: NOW - 1 });
    expect(await invoke(pairing.claimPairingCode, ctx, { code: "ABC234" })).toEqual({
      error: "pairing_code_expired",
    });
    expect(ctx.db.rows("cmd_pairingRequests")).toHaveLength(0);
  });

  it("rejects a second claim of the same code", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1", apiKey: "key-1" });
    expect(
      (
        (await invoke(pairing.claimPairingCode, ctx, { code: "ABC234" })) as {
          error: string | null;
        }
      ).error,
    ).toBeNull();

    const other = makeCtx({ subject: "user-2|s" });
    // Same store, second account.
    Object.assign(other, { db: ctx.db });
    expect(await invoke(pairing.claimPairingCode, other, { code: "ABC234" })).toEqual({
      error: "code_already_claimed",
    });
  });

  it("blocks claiming a device a different account already owns", async () => {
    const ctx = makeCtx({ subject: "user-B|s" });
    request(ctx, { deviceId: "dev-shared", apiKey: "key-1" });
    drone(ctx, { userId: "owner-A", deviceId: "dev-shared" });

    expect(await invoke(pairing.claimPairingCode, ctx, { code: "ABC234" })).toEqual({
      error: "device_owned_by_other",
    });
    // The rejected attempt must not consume the code.
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBeUndefined();
  });

  it("lets the same owner re-pair their own device (upsert, no new row)", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1", apiKey: "rotated-key" });
    drone(ctx, { userId: "user-1", deviceId: "dev-1" });

    const result = await invoke(pairing.claimPairingCode, ctx, { code: "ABC234" });
    expect((result as { error: string | null }).error).toBeNull();
    expect(ctx.db.rows("cmd_drones")).toHaveLength(1);
    expect(ctx.db.rows("cmd_drones")[0].apiKey).toBe("rotated-key");
  });
});

describe("claimPairingCodeAnon", () => {
  it("claims a fresh code under the session's derived owner marker", async () => {
    const ctx = makeCtx();
    request(ctx, { deviceId: "dev-1", apiKey: "key-1" });
    const { secret, marker } = await session(ctx);

    const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });
    expect((result as { error: string | null }).error).toBeNull();
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBe(marker);
    expect(ctx.db.rows("cmd_drones")[0].userId).toBe(marker);
  });

  it("expires past-TTL codes", async () => {
    const ctx = makeCtx();
    request(ctx, { expiresAt: NOW - 1 });
    const { secret } = await session(ctx);
    expect(
      await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "ABC234",
        browserSessionSecret: secret,
      }),
    ).toEqual({ error: "pairing_code_expired" });
  });

  it("rejects a code already claimed by a DIFFERENT session", async () => {
    const ctx = makeCtx();
    request(ctx, { deviceId: "dev-1", claimedBy: "browser:cmd_browserSessions:999" });
    const { secret } = await session(ctx);
    expect(
      await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "ABC234",
        browserSessionSecret: secret,
      }),
    ).toEqual({ error: "code_already_claimed" });
  });

  it("allows the SAME session to re-claim its own code", async () => {
    const ctx = makeCtx();
    const { secret, marker } = await session(ctx);
    request(ctx, { deviceId: "dev-1", apiKey: "key-1", claimedBy: marker });

    const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });
    expect((result as { error: string | null }).error).toBeNull();
  });

  it("blocks a device already owned by a signed-in account", async () => {
    const ctx = makeCtx();
    request(ctx, { deviceId: "dev-shared", apiKey: "key-1" });
    drone(ctx, { userId: "real-account-id", deviceId: "dev-shared" });
    const { secret } = await session(ctx);

    expect(
      await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "ABC234",
        browserSessionSecret: secret,
      }),
    ).toEqual({ error: "device_owned_by_other" });
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBeUndefined();
  });
});

describe("preGenerateCode (explicit code)", () => {
  it("inserts a request with a fresh TTL when the code is free", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    const result = await invoke(pairing.preGenerateCode, ctx, { code: "ABC234" });
    expect(result).toMatchObject({ code: "ABC234" });
    const row = ctx.db.rows("cmd_pairingRequests")[0];
    expect(row.createdBy).toBe("user-1");
    expect(Number(row.expiresAt)).toBeGreaterThan(NOW);
  });

  it("generates a code from the safe charset when none is supplied", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    const result = await invoke(pairing.preGenerateCode, ctx, {});
    expect((result as { code: string }).code).toMatch(
      /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/,
    );
  });

  it("reclaims an expired, unclaimed code with the same value", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { expiresAt: NOW - 1 });
    const result = await invoke(pairing.preGenerateCode, ctx, { code: "ABC234" });
    expect(result).toMatchObject({ code: "ABC234" });
    const live = ctx.db
      .rows("cmd_pairingRequests")
      .filter((r) => r.pairingCode === "ABC234");
    expect(live).toHaveLength(1);
    expect(live[0].createdBy).toBe("user-1");
  });

  it("rejects an explicit code that collides with a live request", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { createdBy: "user-9" });
    await expect(
      invoke(pairing.preGenerateCode, ctx, { code: "ABC234" }),
    ).rejects.toThrow(/Pairing code already exists/);
  });

  it("rejects an explicit code that collides with a claimed-but-unexpired request", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { createdBy: "user-9", claimedBy: "user-9" });
    await expect(
      invoke(pairing.preGenerateCode, ctx, { code: "ABC234" }),
    ).rejects.toThrow(/Pairing code already exists/);
  });
});

describe("wipePairStateForOwnedDevice", () => {
  it("refuses a device owned by a different account", async () => {
    const ctx = makeCtx({ subject: "user-B|s" });
    drone(ctx, { userId: "owner-A", deviceId: "dev-1" });
    await expect(
      invoke(pairing.wipePairStateForOwnedDevice, ctx, { deviceId: "dev-1" }),
    ).rejects.toThrow(/owned by a different account/);
    expect(ctx.db.rows("cmd_drones")).toHaveLength(1);
  });

  it("wipes every row keyed to the owner's own device, blobs included", async () => {
    const ctx = makeCtx({ subject: "user-1|s" });
    request(ctx, { deviceId: "dev-1" });
    drone(ctx, { userId: "user-1", deviceId: "dev-1" });
    ctx.db.seed("cmd_droneStatus", [{ deviceId: "dev-1", updatedAt: NOW }]);
    // A queued command is the one the terminal-row sweep can never reach: it
    // has no completedAt, so before the cascade it outlived the pairing and
    // would be handed to the agent if the device were ever re-paired.
    ctx.db.seed("cmd_droneCommands", [
      { deviceId: "dev-1", userId: "user-1", command: "service_restart", status: "pending", createdAt: NOW },
      { deviceId: "dev-1", userId: "user-1", command: "reboot", status: "completed", createdAt: NOW, completedAt: NOW },
      { deviceId: "dev-2", userId: "user-1", command: "reboot", status: "pending", createdAt: NOW },
    ]);
    ctx.db.seed("cmd_atlasJobs", [
      { deviceId: "dev-1", computeNodeId: "ws-1", kind: "splat", status: "done" },
      { deviceId: "dev-2", computeNodeId: "ws-1", kind: "splat", status: "done" },
    ]);
    ctx.db.seed("logd_windows", [
      { userId: "user-1", deviceId: "dev-1", storageId: "blob-1", pushedAt: NOW },
    ]);
    // The public mutation delegates the sweep through ctx.runMutation so the
    // wipe stays one code path; dispatch straight at the internal handler.
    Object.assign(ctx, {
      runMutation: (_ref: unknown, args: unknown) =>
        invoke(pairing.wipeByDeviceIds, ctx, args),
    });

    const result = await invoke(pairing.wipePairStateForOwnedDevice, ctx, {
      deviceId: "dev-1",
    });
    expect(result).toEqual({
      removedRequests: 1,
      removedDrones: 1,
      removedStatus: 1,
      removedCommands: 2,
      removedAtlasJobs: 1,
      removedLogWindows: 1,
      truncated: false,
    });
    expect(ctx.db.rows("cmd_drones")).toHaveLength(0);
    expect(ctx.db.rows("cmd_pairingRequests")).toHaveLength(0);
    expect(ctx.db.rows("cmd_droneStatus")).toHaveLength(0);
    // Another device's rows are untouched.
    expect(ctx.db.rows("cmd_droneCommands").map((r) => r.deviceId)).toEqual(["dev-2"]);
    expect(ctx.db.rows("cmd_atlasJobs").map((r) => r.deviceId)).toEqual(["dev-2"]);
    // The window's blob goes with its row.
    expect(ctx.db.rows("logd_windows")).toHaveLength(0);
    expect(ctx.deletedStorage).toEqual(["blob-1"]);
  });
});

describe("cleanExpiredSecurityState", () => {
  it("never deletes a bucket that is still locked", async () => {
    const ctx = makeCtx();
    const settled = NOW - 2 * 24 * 60 * 60 * 1000;
    ctx.db.seed("cmd_authAttempts", [
      {
        key: "claim:session:settled",
        attempts: 3,
        firstAttemptAt: settled,
        lastAttemptAt: settled,
        lockedUntil: 0,
      },
      {
        // Idle long enough to be in range, but still serving a lockout.
        // Deleting this row would hand the attacker a free reset.
        key: "claim:session:locked",
        attempts: 99,
        firstAttemptAt: settled,
        lastAttemptAt: settled,
        lockedUntil: NOW + 60_000,
      },
    ]);

    const result = await invoke(pairing.cleanExpiredSecurityState, ctx, {});
    expect(result).toMatchObject({ deletedBuckets: 1 });
    expect(ctx.db.rows("cmd_authAttempts").map((r) => r.key)).toEqual([
      "claim:session:locked",
    ]);
  });
});

describe("registerAgent pending-request binding", () => {
  const base = {
    clientKey: "ip-digest-aaaa",
    deviceId: "dev-9",
    pairingCode: "ABC234",
    apiKey: "agent-key",
  };

  it("refuses a different key and code on a live pending request", async () => {
    const ctx = makeCtx();
    await invoke(pairing.registerAgent, ctx, base);
    const result = await invoke(pairing.registerAgent, ctx, {
      ...base,
      clientKey: "ip-digest-bbbb",
      pairingCode: "XYZ789",
      apiKey: "attacker-key",
    });
    expect(result).toEqual({ error: "device_registration_conflict" });
    expect(ctx.db.rows("cmd_pairingRequests")[0]).toMatchObject({
      pairingCode: "ABC234",
      apiKey: "agent-key",
    });
  });

  it("lets a new key take over once the pending window lapsed", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_pairingRequests", [
      { deviceId: "dev-9", pairingCode: "ABC234", apiKey: "old-key", expiresAt: NOW - 1 },
    ]);
    expect(await invoke(pairing.registerAgent, ctx, base)).toEqual({ registered: true });
    expect(ctx.db.rows("cmd_pairingRequests")[0].apiKey).toBe("agent-key");
  });

  it("bounds first-contact tries of one code across many source addresses", async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 10; i++) {
      await invoke(pairing.registerAgent, ctx, {
        ...base,
        clientKey: `ip-${i}`,
        deviceId: `probe-${i}`,
        pairingCode: "QRS234",
      });
    }
    expect(
      await invoke(pairing.registerAgent, ctx, {
        ...base,
        clientKey: "ip-fresh",
        deviceId: "probe-fresh",
        pairingCode: "QRS234",
      }),
    ).toMatchObject({ error: "rate_limited" });
  });
});

describe("anonymous global buckets", () => {
  it("never refuses a session mint, however many came before", async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 40; i++) await session(ctx);
    expect(ctx.db.rows("cmd_browserSessions")).toHaveLength(40);
  });

  it("charges the global claim bucket only for failed codes, and a success does not reset it", async () => {
    const ctx = makeCtx();
    const { secret } = await session(ctx);
    request(ctx);
    const global = () => ctx.db.rows("cmd_authAttempts").find((r) => r.key === "claim:global");

    await invoke(pairing.claimPairingCodeAnon, ctx, { code: "ZZZ234", browserSessionSecret: secret });
    expect(global()?.attempts).toBe(1);

    const ok = await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });
    expect(ok).toMatchObject({ error: null });
    expect(global()?.attempts).toBe(1);
  });
});

describe("cleanExpiredRequests", () => {
  it("drains expired unclaimed rows behind any number of claimed ones", async () => {
    const ctx = makeCtx();
    const old = NOW - 60 * 60 * 1000;
    ctx.db.seed(
      "cmd_pairingRequests",
      Array.from({ length: 300 }, (_, i) => ({
        pairingCode: `C${i}`,
        expiresAt: old - 1000 + i,
        claimedBy: "owner",
      })),
    );
    ctx.db.seed("cmd_pairingRequests", [{ pairingCode: "UNCLM1", expiresAt: old + 5000 }]);

    const result = await invoke(pairing.cleanExpiredRequests, ctx, {});
    expect(result).toEqual({ deleted: 1 });
    const left = ctx.db.rows("cmd_pairingRequests");
    expect(left).toHaveLength(300);
    expect(left.every((r) => r.claimedBy === "owner")).toBe(true);
  });

  it("reschedules itself while a full batch was deleted", async () => {
    const ctx = makeCtx();
    ctx.db.seed(
      "cmd_pairingRequests",
      Array.from({ length: 300 }, (_, i) => ({ pairingCode: `U${i}`, expiresAt: NOW - 1000 - i })),
    );
    await invoke(pairing.cleanExpiredRequests, ctx, {});
    expect(ctx.db.rows("cmd_pairingRequests")).toHaveLength(44);
    expect(ctx.scheduled).toHaveLength(1);
  });
});
