/**
 * What an UNAUTHENTICATED caller can reach, and what it gets back.
 *
 * Every case here invokes the real exported handler through `invoke`, so it
 * fails on a behavioural regression rather than on a reworded comment. The
 * defects being pinned, each of which was live:
 *
 *   - `registerAgent` was a PUBLIC mutation: any browser holding a
 *     `ConvexReactClient` could write an attacker-chosen `apiKey` keyed by any
 *     `deviceId`, and could drive the pre-generated auto-match branch — which
 *     inserts a `cmd_drones` row into the code generator's fleet — as fast as
 *     it could guess six-character codes.
 *   - `claimPairingCodeAnon` RETURNED the agent's `apiKey` to an anonymous
 *     caller whose only credential was that six-character code, and took the
 *     OWNER as an argument, so knowing another browser's id was enough to
 *     assert ownership of its nodes.
 *   - `getPairingStatus` was a public claim oracle keyed on `deviceId` alone.
 *   - Nothing anywhere in either Convex tree counted a failed attempt, so the
 *     code space was walkable at whatever rate a script could manage.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as pairing from "../../convex/cmdPairing";
import * as comments from "../../convex/comments";
import * as contact from "../../convex/contactSubmissions";
import {
  CLAIM_POLICY,
  lockoutDurationMs,
  sha256Hex,
} from "../../convex/lib/rateLimit";
import { invoke, isPublic, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const NOW_ISH = Date.now();
const LIVE_EXPIRY = NOW_ISH + 10 * 60 * 1000;
const AGENT_KEY = "ados_live_agent_key_value";

/** Mint a browser session the way a real anonymous browser does, then read it. */
async function anonSession(ctx: FakeCtx): Promise<string> {
  const result = await invoke(pairing.issueBrowserSession, ctx);
  const secret = (result as { browserSessionSecret: string }).browserSessionSecret;
  expect(secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
  return secret;
}

function seedLiveRequest(ctx: FakeCtx, overrides: Record<string, unknown> = {}) {
  return ctx.db.seed("cmd_pairingRequests", [
    {
      deviceId: "ados-x-0001",
      pairingCode: "ABC234",
      agentName: "Test Drone",
      apiKey: AGENT_KEY,
      mdnsHost: "ados-x.local",
      localIp: "192.168.1.50",
      expiresAt: LIVE_EXPIRY,
      ...overrides,
    },
  ])[0];
}

/** Deep scan for an agent key anywhere in a response, at any nesting depth. */
function leaksKey(value: unknown): boolean {
  if (typeof value === "string") return value === AGENT_KEY;
  if (Array.isArray(value)) return value.some(leaksKey);
  if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      if (key === "apiKey") return true;
      if (leaksKey(inner)) return true;
    }
  }
  return false;
}

describe("exposure of the pairing surface", () => {
  it("keeps the agent-facing writers off the public API", () => {
    // These two are reached only through their HTTP routes, which supply the
    // source-address rate-limit bucket and the device's own API key.
    expect(isPublic(pairing.registerAgent)).toBe(false);
    expect(isPublic(pairing.getPairingStatus)).toBe(false);
    expect(isPublic(pairing.listMqttAuthEntries)).toBe(false);
    expect(isPublic(pairing.wipeByDeviceIds)).toBe(false);
    expect(isPublic(pairing.cleanExpiredRequests)).toBe(false);
    expect(isPublic(pairing.cleanExpiredSecurityState)).toBe(false);
  });

  it("keeps the operator-facing claim paths public", () => {
    // The anonymous pair flow is a product promise ("no account required"), so
    // these stay public and are defended by rate limiting, not by auth.
    expect(isPublic(pairing.claimPairingCodeAnon)).toBe(true);
    expect(isPublic(pairing.issueBrowserSession)).toBe(true);
    expect(isPublic(pairing.claimPairingCode)).toBe(true);
    expect(isPublic(pairing.preGenerateCode)).toBe(true);
  });
});

describe("claimPairingCodeAnon", () => {
  it("never returns an agent apiKey on the success path", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);
    const secret = await anonSession(ctx);

    const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });

    expect(result).toMatchObject({ error: null, deviceId: "ados-x-0001" });
    expect(leaksKey(result)).toBe(false);
    // The browser still gets what it actually needs: an address to probe.
    expect(result).toMatchObject({
      mdnsHost: "ados-x.local",
      localIp: "192.168.1.50",
    });
  });

  it("still writes the cloud row the agent heartbeat authenticates against", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);
    const secret = await anonSession(ctx);

    await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });

    const drones = ctx.db.rows("cmd_drones");
    expect(drones).toHaveLength(1);
    // The key is persisted server-side (the heartbeat needs it); it is simply
    // never handed to the caller.
    expect(drones[0].apiKey).toBe(AGENT_KEY);
    expect(String(drones[0].userId)).toMatch(/^browser:/);
  });

  it("refuses a browser session this server did not mint", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);

    const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: "attacker-chosen-browser-identity",
    });

    expect(result).toEqual({ error: "invalid_browser_session" });
    expect(ctx.db.rows("cmd_drones")).toHaveLength(0);
    // And the code is NOT consumed, so a rejected attempt cannot be used to
    // burn a legitimate operator's pairing window.
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBeUndefined();
  });

  it("derives the owner from the session rather than from an argument", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);
    const victim = await anonSession(ctx);
    const attacker = await anonSession(ctx);

    await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: victim,
    });
    const owner = ctx.db.rows("cmd_drones")[0].userId;

    // Re-presenting the same code from a second session: refused at the
    // already-claimed guard, which fires before anything is written.
    expect(
      await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "ABC234",
        browserSessionSecret: attacker,
      }),
    ).toEqual({ error: "code_already_claimed" });
    expect(ctx.db.rows("cmd_drones")[0].userId).toBe(owner);

    // A SECOND live code for the same device — the rotated-code case a real
    // agent produces — reaches the ownership guard instead. Under the old
    // design an attacker who knew the victim's browser id passed that guard,
    // because the owner it compared against was whatever the caller asserted.
    seedLiveRequest(ctx, { pairingCode: "XYZ345" });
    expect(
      await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "XYZ345",
        browserSessionSecret: attacker,
      }),
    ).toEqual({ error: "device_owned_by_other" });
    expect(ctx.db.rows("cmd_drones")[0].userId).toBe(owner);
  });

  it("never returns an apiKey on any failure path either", async () => {
    for (const scenario of ["missing", "expired", "claimed"] as const) {
      const ctx = makeCtx();
      if (scenario === "expired") {
        seedLiveRequest(ctx, { expiresAt: NOW_ISH - 1 });
      } else if (scenario === "claimed") {
        seedLiveRequest(ctx, { claimedBy: "browser:someone-else" });
      }
      const secret = await anonSession(ctx);
      const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: "ABC234",
        browserSessionSecret: secret,
      });
      expect(leaksKey(result)).toBe(false);
      expect((result as { error: string | null }).error).not.toBeNull();
    }
  });

  it("locks out a session that walks the code space", async () => {
    const ctx = makeCtx();
    const secret = await anonSession(ctx);
    const codes = ["AAAA22", "BBBB33", "CCCC44", "DDDD55", "EEEE66", "FFFF77"];

    // maxAttempts failures are answered normally.
    for (let i = 0; i < CLAIM_POLICY.maxAttempts; i++) {
      const result = await invoke(pairing.claimPairingCodeAnon, ctx, {
        code: codes[i],
        browserSessionSecret: secret,
      });
      expect(result).toEqual({ error: "invalid_pairing_code" });
    }

    // The next one is refused before the lookup happens.
    await expect(
      invoke(pairing.claimPairingCodeAnon, ctx, {
        code: codes[CLAIM_POLICY.maxAttempts],
        browserSessionSecret: secret,
      }),
    ).rejects.toThrow(/rate_limited/);
  });

  it("clears the bucket after a genuine claim so an operator never ladders", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);
    const secret = await anonSession(ctx);
    const digest = await sha256Hex(secret);

    // Two fat-fingered codes, then the right one.
    await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "AAAA22",
      browserSessionSecret: secret,
    });
    await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "BBBB33",
      browserSessionSecret: secret,
    });
    expect(
      ctx.db.rows("cmd_authAttempts").some((r) => r.key === `claim:session:${digest}`),
    ).toBe(true);

    await invoke(pairing.claimPairingCodeAnon, ctx, {
      code: "ABC234",
      browserSessionSecret: secret,
    });
    expect(
      ctx.db.rows("cmd_authAttempts").some((r) => r.key === `claim:session:${digest}`),
    ).toBe(false);
  });
});

describe("claimPairingCode (signed in)", () => {
  it("rejects an unauthenticated caller before touching the code", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);
    await expect(
      invoke(pairing.claimPairingCode, ctx, { code: "ABC234" }),
    ).rejects.toThrow(/Not authenticated/);
    expect(ctx.db.rows("cmd_pairingRequests")[0].claimedBy).toBeUndefined();
  });

  it("returns the key only to the authenticated claimant", async () => {
    const ctx = makeCtx({ subject: "user_alice|session_1" });
    seedLiveRequest(ctx);
    const result = await invoke(pairing.claimPairingCode, ctx, { code: "ABC234" });
    expect(result).toMatchObject({ error: null, apiKey: AGENT_KEY });
    expect(ctx.db.rows("cmd_drones")[0].userId).toBe("user_alice");
  });
});

describe("preGenerateCode / getMyPendingCodes", () => {
  it("rejects an unauthenticated generator", async () => {
    const ctx = makeCtx();
    await expect(invoke(pairing.preGenerateCode, ctx, {})).rejects.toThrow(
      /Not authenticated/,
    );
    expect(ctx.db.rows("cmd_pairingRequests")).toHaveLength(0);
  });

  it("returns no pending codes to an anonymous caller", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx, { createdBy: "user_alice" });
    expect(await invoke(pairing.getMyPendingCodes, ctx, {})).toEqual([]);
  });

  it("never includes the agent key in a pending-codes listing", async () => {
    const ctx = makeCtx({ subject: "user_alice|session_1" });
    seedLiveRequest(ctx, { createdBy: "user_alice" });
    const rows = await invoke(pairing.getMyPendingCodes, ctx, {});
    expect(Array.isArray(rows)).toBe(true);
    expect(rows).toHaveLength(1);
    expect(leaksKey(rows)).toBe(false);
    expect((rows as Array<{ pairingCode: string }>)[0].pairingCode).toBe("ABC234");
  });
});

describe("registerAgent (internal, agent-facing)", () => {
  const base = {
    clientKey: "ip-digest-aaaa",
    deviceId: "ados-x-0001",
    pairingCode: "ABC234",
    apiKey: AGENT_KEY,
    name: "Test Drone",
  };

  it("requires a non-empty apiKey", async () => {
    const ctx = makeCtx();
    await expect(
      invoke(pairing.registerAgent, ctx, { ...base, apiKey: "  " }),
    ).rejects.toThrow(/apiKey required/);
    expect(ctx.db.rows("cmd_pairingRequests")).toHaveLength(0);
  });

  it("refuses to rotate a paired device's cloud credential", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_drones", [
      {
        userId: "user_alice",
        deviceId: "ados-x-0001",
        name: "Alice's drone",
        apiKey: AGENT_KEY,
        lastSeen: NOW_ISH,
        fcConnected: false,
        pairedAt: NOW_ISH,
      },
    ]);

    const result = await invoke(pairing.registerAgent, ctx, {
      ...base,
      apiKey: "ados_attacker_supplied_key",
    });

    expect(result).toEqual({ error: "device_registration_conflict" });
    expect(ctx.db.rows("cmd_drones")[0].apiKey).toBe(AGENT_KEY);
  });

  it("lets the real agent re-register for free, without laddering", async () => {
    const ctx = makeCtx();
    // First contact charges one attempt.
    expect(await invoke(pairing.registerAgent, ctx, base)).toEqual({
      registered: true,
    });
    const afterFirst = ctx.db
      .rows("cmd_authAttempts")
      .find((r) => r.key === "register:ip-digest-aaaa");
    expect(afterFirst?.attempts).toBe(1);

    // The beacon re-posts the same key many more times than the policy would
    // allow if it were charged. A throttled beacon is a black video feed and a
    // node that never appears, so this must stay free.
    for (let i = 0; i < 40; i++) {
      expect(await invoke(pairing.registerAgent, ctx, base)).toEqual({
        registered: true,
      });
    }
    const afterBeacons = ctx.db
      .rows("cmd_authAttempts")
      .find((r) => r.key === "register:ip-digest-aaaa");
    expect(afterBeacons?.attempts).toBe(1);
  });

  it("locks out a source address enumerating device ids", async () => {
    const ctx = makeCtx();
    // Each attempt needs a fresh deviceId (a reused one hits the binding), so
    // the source address is the only stable axis — which is what is bucketed.
    for (let i = 0; i < 10; i++) {
      await invoke(pairing.registerAgent, ctx, {
        ...base,
        deviceId: `probe-${i}`,
        pairingCode: "ZZZZ99",
      });
    }
    await expect(
      invoke(pairing.registerAgent, ctx, {
        ...base,
        deviceId: "probe-overflow",
        pairingCode: "ZZZZ99",
      }),
    ).rejects.toThrow(/rate_limited/);
  });

  it("still auto-matches a legitimate pre-generated code", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_pairingRequests", [
      { pairingCode: "ABC234", expiresAt: LIVE_EXPIRY, createdBy: "user_alice" },
    ]);
    const result = await invoke(pairing.registerAgent, ctx, base);
    expect(result).toEqual({ autoMatched: true, userId: "user_alice" });
    expect(ctx.db.rows("cmd_drones")[0]).toMatchObject({
      userId: "user_alice",
      deviceId: "ados-x-0001",
      apiKey: AGENT_KEY,
    });
  });
});

describe("getPairingStatus (internal, key-authenticated)", () => {
  it("answers identically for an unknown device and a wrong key", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx);

    const wrongKey = await invoke(pairing.getPairingStatus, ctx, {
      deviceId: "ados-x-0001",
      apiKey: "guessed",
    });
    const unknownDevice = await invoke(pairing.getPairingStatus, ctx, {
      deviceId: "does-not-exist",
      apiKey: AGENT_KEY,
    });

    // One answer for both, so the route cannot be walked to enumerate device
    // ids or to learn that a given device is mid-pairing.
    expect(wrongKey).toEqual({ authorized: false });
    expect(unknownDevice).toEqual({ authorized: false });
  });

  it("answers the device that holds the key", async () => {
    const ctx = makeCtx();
    seedLiveRequest(ctx, { claimedBy: "user_alice", claimedAt: NOW_ISH });
    const result = await invoke(pairing.getPairingStatus, ctx, {
      deviceId: "ados-x-0001",
      apiKey: AGENT_KEY,
    });
    expect(result).toMatchObject({
      authorized: true,
      claimed: true,
      claimedBy: "user_alice",
    });
  });
});

describe("listMqttAuthEntries", () => {
  it("is bounded and reports truncation instead of silently capping", async () => {
    const ctx = makeCtx();
    ctx.db.seed(
      "cmd_drones",
      Array.from({ length: 2100 }, (_, i) => ({
        userId: "user_alice",
        deviceId: `ados-x-${i}`,
        name: `drone-${i}`,
        apiKey: `ados_key_${i}`,
        lastSeen: NOW_ISH,
        fcConnected: false,
        pairedAt: NOW_ISH,
      })),
    );
    const result = (await invoke(pairing.listMqttAuthEntries, ctx, {})) as {
      entries: unknown[];
      grants: unknown[];
      truncated: boolean;
    };
    expect(result.entries).toHaveLength(2000);
    expect(result.truncated).toBe(true);
  });

  it("drops revoked grants", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_mqttControlGrants", [
      {
        userId: "user_alice",
        principal: "gcs-op-live",
        passwdEntry: "gcs-op-live:$7$live",
        deviceIds: ["ados-x-0001"],
        createdAt: NOW_ISH,
        expiresAt: LIVE_EXPIRY,
      },
      {
        userId: "user_alice",
        principal: "gcs-op-revoked",
        passwdEntry: "gcs-op-revoked:$7$revoked",
        deviceIds: ["ados-x-0001"],
        createdAt: NOW_ISH,
        expiresAt: LIVE_EXPIRY,
        revokedAt: NOW_ISH,
      },
    ]);
    const result = (await invoke(pairing.listMqttAuthEntries, ctx, {})) as {
      grants: Array<{ principal: string }>;
    };
    expect(result.grants.map((g) => g.principal)).toEqual(["gcs-op-live"]);
  });
});

describe("comments.countByTargets", () => {
  it("refuses an unbounded target array", async () => {
    const ctx = makeCtx();
    const targets = Array.from({ length: 65 }, (_, i) => ({
      targetType: "changelog" as const,
      targetId: `t${i}`,
    }));
    await expect(invoke(comments.countByTargets, ctx, { targets })).rejects.toThrow(
      /may not exceed/,
    );
  });

  it("de-duplicates repeated targets", async () => {
    const ctx = makeCtx();
    ctx.db.seed("comments", [
      { targetType: "changelog", targetId: "t1", authorId: "u", body: "x" },
    ]);
    const targets = Array.from({ length: 40 }, () => ({
      targetType: "changelog" as const,
      targetId: "t1",
    }));
    const out = (await invoke(comments.countByTargets, ctx, { targets })) as unknown[];
    expect(out).toEqual([{ targetType: "changelog", targetId: "t1", count: 1 }]);
  });
});

describe("contactSubmissions.submit", () => {
  const body = {
    name: "A Person",
    email: "Someone@Example.com",
    message: "Hello",
  };

  it("refuses an oversized message rather than storing it", async () => {
    const ctx = makeCtx();
    await expect(
      invoke(contact.submit, ctx, { ...body, message: "x".repeat(5001) }),
    ).rejects.toThrow(/message too long/);
    expect(ctx.db.rows("contactSubmissions")).toHaveLength(0);
    expect(ctx.scheduled).toHaveLength(0);
  });

  it("stops a flood before it reaches the webhook scheduler", async () => {
    const ctx = makeCtx();
    for (let i = 0; i < 3; i++) {
      await invoke(contact.submit, ctx, body);
    }
    await expect(invoke(contact.submit, ctx, body)).rejects.toThrow(/rate_limited/);
    expect(ctx.db.rows("contactSubmissions")).toHaveLength(3);
    expect(ctx.scheduled).toHaveLength(3);
  });
});

describe("lockoutDurationMs", () => {
  it("doubles per overflow attempt and stops at the ceiling", () => {
    const policy = {
      maxAttempts: 3,
      windowMs: 1000,
      baseLockoutMs: 1000,
      maxLockoutMs: 8000,
    };
    expect(lockoutDurationMs(0, policy)).toBe(0);
    expect(lockoutDurationMs(1, policy)).toBe(1000);
    expect(lockoutDurationMs(2, policy)).toBe(2000);
    expect(lockoutDurationMs(3, policy)).toBe(4000);
    expect(lockoutDurationMs(4, policy)).toBe(8000);
    expect(lockoutDurationMs(5, policy)).toBe(8000);
  });

  it("never overflows the shift into a negative or infinite lockout", () => {
    const policy = {
      maxAttempts: 1,
      windowMs: 1000,
      baseLockoutMs: 1000,
      maxLockoutMs: 60_000,
    };
    // 1 << 31 is negative in JS and a Math.min after the fact would return it,
    // which reads as "not locked" — the exact opposite of the intent.
    for (const overflow of [31, 40, 1000]) {
      const value = lockoutDurationMs(overflow, policy);
      expect(value).toBe(60_000);
    }
  });
});
