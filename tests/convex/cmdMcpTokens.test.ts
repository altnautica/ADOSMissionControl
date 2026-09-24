/**
 * ADOS MCP machine-credential surface, exercised through the real handlers.
 *
 * The credential is the operator's fleet reach and the AI client's bearer, so
 * what matters is observable: which functions a browser can call at all, that
 * mint hands the plaintext back once and stores only its hash, that the audit
 * mirror is idempotent and bounded, and that the operator's audit read never
 * carries argument values. The credential lifecycle (revocation, expiry,
 * lockout) is covered in mcpReachCredentials.test.ts.
 */
import { describe, expect, it } from "vitest";

import * as reach from "../../convex/cmdMcpReach";
import * as reachDb from "../../convex/cmdMcpReachDb";
import * as tokens from "../../convex/cmdMcpTokens";
import { sha256Hex } from "../../convex/lib/rateLimit";
import { invoke, isPublic, makeCtx } from "./fakeConvexCtx";

describe("public surface", () => {
  it("exposes only the operator and credential-bearer entry points", () => {
    for (const fn of [tokens.mint, tokens.listMine, tokens.revoke, tokens.recentAuditEvents]) {
      expect(isPublic(fn)).toBe(true);
    }
    for (const fn of [
      reach.verifyCredential,
      reach.listNodes,
      reach.getStatus,
      reach.enqueue,
      reach.getCommandStatus,
      reach.recordAudit,
    ]) {
      expect(isPublic(fn)).toBe(true);
    }
    for (const fn of [
      tokens.insert,
      reachDb.lookupByHash,
      reachDb.touchLastUsed,
      reachDb.listNodesForUser,
      reachDb.getStatusForUser,
      reachDb.enqueueForUser,
      reachDb.getCommandForUser,
      reachDb.insertAuditEvents,
    ]) {
      expect(isPublic(fn)).toBe(false);
    }
  });

  it("does not let an audit event carry its own tokenId", () => {
    const registered = reach.recordAudit as unknown as { exportArgs: () => string };
    const args = JSON.parse(registered.exportArgs()) as {
      value: { events: { fieldType: { value: { value: Record<string, unknown> } } } };
    };
    const eventFields = Object.keys(args.value.events.fieldType.value.value);
    expect(eventFields).toContain("tool");
    expect(eventFields).not.toContain("tokenId");
  });
});

describe("cmdMcpTokens.mint", () => {
  function mintCtx() {
    const stored: Array<Record<string, unknown>> = [];
    const ctx = makeCtx({
      subject: "user-1|session-1",
      run: async (_ref, args) => {
        stored.push(args as Record<string, unknown>);
        return null;
      },
    });
    return { ctx, stored };
  }

  it("refuses a scope outside the vocabulary before storing anything", async () => {
    const { ctx, stored } = mintCtx();
    await expect(
      invoke(tokens.mint, ctx, { label: "x", scopes: ["read", "root"] }),
    ).rejects.toThrow(/unknown scope/);
    expect(stored).toEqual([]);
  });

  it("returns the plaintext once and stores only its hash", async () => {
    const { ctx, stored } = mintCtx();
    const result = (await invoke(tokens.mint, ctx, {
      label: "x",
      scopes: ["read", "flight"],
    })) as { credential: string };
    expect(stored).toHaveLength(1);
    expect(stored[0].tokenHash).toBe(await sha256Hex(result.credential));
    expect(Object.values(stored[0])).not.toContain(result.credential);
  });
});

describe("audit mirror", () => {
  const event = (contentHash: string) => ({
    tool: "arm",
    node: "n1",
    decision: "denied" as const,
    result: "refused",
    plane: "cloud_relay" as const,
    latencyMs: 3,
    tsUs: 1,
    contentHash,
  });

  it("skips an event whose contentHash already exists (idempotent re-push)", async () => {
    const ctx = makeCtx();
    const insert = (hashes: string[]) =>
      invoke(reachDb.insertAuditEvents, ctx, {
        userId: "user-1",
        tokenId: "mct_1",
        events: hashes.map(event),
      });
    expect(await insert(["a", "b"])).toEqual({ inserted: 2 });
    expect(await insert(["b", "c"])).toEqual({ inserted: 1 });
    expect(ctx.db.rows("cmd_mcpAuditEvents")).toHaveLength(3);
  });

  it("bounds the operator read to [1, 500] rows and never returns argument values", async () => {
    const ctx = makeCtx({ subject: "user-1|session-1" });
    ctx.db.seed(
      "cmd_mcpAuditEvents",
      Array.from({ length: 600 }, (_, i) => ({
        ...event(`h${i}`),
        userId: "user-1",
        tokenId: "mct_1",
        createdAt: i,
        args: { secret: "x" },
      })),
    );
    const read = async (limit?: number) =>
      (await invoke(tokens.recentAuditEvents, ctx, limit === undefined ? {} : { limit })) as Array<
        Record<string, unknown>
      >;
    expect(await read()).toHaveLength(200);
    expect(await read(0)).toHaveLength(1);
    const all = await read(10_000);
    expect(all).toHaveLength(500);
    expect(all.some((row) => "args" in row)).toBe(false);
  });
});
