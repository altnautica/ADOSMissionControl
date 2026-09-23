/**
 * Broker control grants are per browser session: a renewal replaces only the
 * grant it names, another session's grant stays live, the live count per
 * operator is bounded, and a lapsed grant never reads as current. Exercised
 * against the real handlers through the in-memory ctx.
 *
 * @license GPL-3.0-only
 */
import { describe, expect, it } from "vitest";

import * as grants from "../../convex/cmdMqttControlGrants";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const HOUR = 60 * 60 * 1000;

function insert(ctx: FakeCtx, principal: string, replaces?: string) {
  return invoke(grants.insert, ctx, {
    userId: "user-1",
    principal,
    passwdEntry: `${principal}:$7$x`,
    deviceIds: ["dev-1"],
    expiresAt: Date.now() + HOUR,
    ...(replaces ? { replaces } : {}),
  });
}

const live = (ctx: FakeCtx) =>
  ctx.db
    .rows("cmd_mqttControlGrants")
    .filter((r) => !r.revokedAt)
    .map((r) => r.principal);

describe("grant minting", () => {
  it("leaves another session's live grant alone", async () => {
    const ctx = makeCtx();
    await insert(ctx, "tab-a");
    await insert(ctx, "tab-b");
    expect(live(ctx)).toEqual(["tab-a", "tab-b"]);
  });

  it("revokes exactly the grant a renewal replaces", async () => {
    const ctx = makeCtx();
    await insert(ctx, "tab-a");
    await insert(ctx, "tab-b");
    await insert(ctx, "tab-a-2", "tab-a");
    expect(live(ctx)).toEqual(["tab-b", "tab-a-2"]);
  });

  it("bounds the live grants per operator, retiring the oldest", async () => {
    const ctx = makeCtx();
    for (const p of ["g1", "g2", "g3", "g4", "g5"]) await insert(ctx, p);
    expect(live(ctx)).toEqual(["g2", "g3", "g4", "g5"]);
  });
});

describe("myCurrent", () => {
  it("does not report a grant past its expiry", async () => {
    const ctx = makeCtx({ subject: "user-1|session-1" });
    ctx.db.seed("cmd_mqttControlGrants", [
      {
        userId: "user-1",
        principal: "lapsed",
        passwdEntry: "x",
        deviceIds: ["dev-1"],
        createdAt: Date.now() - 2 * HOUR,
        expiresAt: Date.now() - 1,
      },
    ]);
    expect(await invoke(grants.myCurrent, ctx, { principal: "lapsed" })).toBeNull();
  });

  it("reports only the caller's own grant", async () => {
    const ctx = makeCtx({ subject: "user-2|session-1" });
    await insert(ctx, "tab-a");
    expect(await invoke(grants.myCurrent, ctx, { principal: "tab-a" })).toBeNull();
  });
});

describe("pruneExpiredGrants", () => {
  it("deletes rows expired past the review window and keeps the rest", async () => {
    const ctx = makeCtx();
    ctx.db.seed("cmd_mqttControlGrants", [
      { userId: "u", principal: "old", passwdEntry: "x", deviceIds: [], createdAt: 0, expiresAt: Date.now() - 48 * HOUR },
      { userId: "u", principal: "recent", passwdEntry: "x", deviceIds: [], createdAt: 0, expiresAt: Date.now() - HOUR },
    ]);
    expect(await invoke(grants.pruneExpiredGrants, ctx, {})).toEqual({ deleted: 1 });
    expect(ctx.db.rows("cmd_mqttControlGrants").map((r) => r.principal)).toEqual(["recent"]);
  });
});
