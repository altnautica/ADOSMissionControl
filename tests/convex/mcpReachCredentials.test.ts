/**
 * The MCP reach surface is a set of PUBLIC actions whose only argument is a
 * bearer string. Two defects were live:
 *
 *   - No lockout anywhere, so `authorize` was a free, unlimited oracle for
 *     guessing a credential at whatever rate a client could manage.
 *   - `verifyCredential` wrapped `authorize` in a bare `catch {}` and returned
 *     `null`, so a rejected credential, a lockout, a schema error and a backend
 *     outage were indistinguishable — to the MCP server and to anyone reading
 *     the logs.
 *
 * Also pins the standing invariant that no `research_`-prefixed table or
 * function reaches the OSS tree. That currently holds and must keep holding:
 * the investor/research surface is private and lives only in `website/convex`.
 *
 * @license GPL-3.0-only
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getFunctionName } from "convex/server";

import * as reach from "../../convex/cmdMcpReach";
import * as reachDb from "../../convex/cmdMcpReachDb";
import { CREDENTIAL_POLICY } from "../../convex/lib/rateLimit";
import { invoke, makeCtx, type FakeCtx } from "./fakeConvexCtx";

const CONVEX_DIR = path.join(process.cwd(), "convex");

/**
 * Action ctx whose `runQuery`/`runMutation` dispatch by function name into the
 * real internal handlers, so the whole authorize path runs for real: the
 * limiter writes to the fake `cmd_authAttempts` table and the token lookup
 * reads the fake `cmd_mcpTokens` table.
 */
function actionCtx(options: { lookupThrows?: boolean } = {}): FakeCtx {
  const ctx: FakeCtx = makeCtx();
  const dispatch = async (ref: unknown, args: unknown) => {
    const name = getFunctionName(
      ref as Parameters<typeof getFunctionName>[0],
    );
    switch (name) {
      case "cmdMcpReachDb:consumeCredentialAttempt":
        return await invoke(reachDb.consumeCredentialAttempt, ctx, args);
      case "cmdMcpReachDb:clearCredentialAttempts":
        return await invoke(reachDb.clearCredentialAttempts, ctx, args);
      case "cmdMcpReachDb:lookupByHash":
        if (options.lookupThrows) {
          throw new Error("Server Error: index by_tokenHash does not exist");
        }
        return await invoke(reachDb.lookupByHash, ctx, args);
      case "cmdMcpReachDb:touchLastUsed":
        return await invoke(reachDb.touchLastUsed, ctx, args);
      default:
        throw new Error(`unexpected internal call: ${name}`);
    }
  };
  Object.assign(ctx, { runQuery: dispatch, runMutation: dispatch });
  return ctx;
}

/** SHA-256 hex, matching what `authorize` hashes the presented credential to. */
async function digest(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyCredential", () => {
  it("returns null for a credential that is genuinely not live", async () => {
    const ctx = actionCtx();
    expect(
      await invoke(reach.verifyCredential, ctx, { credential: "not-a-token" }),
    ).toBeNull();
  });

  it("resolves the principal for a live credential", async () => {
    const ctx = actionCtx();
    ctx.db.seed("cmd_mcpTokens", [
      {
        userId: "user_alice",
        tokenId: "tok_1",
        tokenHash: await digest("live-credential"),
        scopes: ["read"],
        allowedNodes: [],
        createdAt: Date.now(),
      },
    ]);
    expect(
      await invoke(reach.verifyCredential, ctx, { credential: "live-credential" }),
    ).toEqual({
      userId: "user_alice",
      scopes: ["read"],
      allowedNodes: [],
      tokenId: "tok_1",
    });
  });

  it("propagates a backend failure instead of reporting it as a bad credential", async () => {
    // The whole point: an infrastructure fault must NOT look like "your token
    // is invalid". The old `catch {}` made those two indistinguishable.
    const ctx = actionCtx({ lookupThrows: true });
    await expect(
      invoke(reach.verifyCredential, ctx, { credential: "live-credential" }),
    ).rejects.toThrow(/index by_tokenHash does not exist/);
  });

  it("locks out a caller probing the credential space", async () => {
    const ctx = actionCtx();
    for (let i = 0; i < CREDENTIAL_POLICY.maxAttempts; i++) {
      expect(
        await invoke(reach.verifyCredential, ctx, { credential: "guess" }),
      ).toBeNull();
    }
    // A lockout is a THROW, not a null: the caller must be able to tell
    // "slow down" from "wrong token".
    await expect(
      invoke(reach.verifyCredential, ctx, { credential: "guess" }),
    ).rejects.toThrow(/rate_limited/);
  });

  it("clears the bucket on success so a live credential never ladders", async () => {
    const ctx = actionCtx();
    ctx.db.seed("cmd_mcpTokens", [
      {
        userId: "user_alice",
        tokenId: "tok_1",
        tokenHash: await digest("live-credential"),
        scopes: ["read"],
        allowedNodes: [],
        createdAt: Date.now(),
      },
    ]);
    for (let i = 0; i < 50; i++) {
      expect(
        await invoke(reach.verifyCredential, ctx, {
          credential: "live-credential",
        }),
      ).not.toBeNull();
    }
    expect(ctx.db.rows("cmd_authAttempts")).toHaveLength(0);
  });

  it("refuses a revoked credential and counts the attempt", async () => {
    const ctx = actionCtx();
    ctx.db.seed("cmd_mcpTokens", [
      {
        userId: "user_alice",
        tokenId: "tok_1",
        tokenHash: await digest("revoked-credential"),
        scopes: ["read"],
        allowedNodes: [],
        createdAt: Date.now(),
        revokedAt: Date.now(),
      },
    ]);
    expect(
      await invoke(reach.verifyCredential, ctx, {
        credential: "revoked-credential",
      }),
    ).toBeNull();
    expect(ctx.db.rows("cmd_authAttempts").length).toBeGreaterThan(0);
  });
});

describe("OSS tree invariants", () => {
  function convexFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "_generated") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...convexFiles(full));
      else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
  }

  it("contains no research_-prefixed table or function", () => {
    const offenders: string[] = [];
    for (const file of convexFiles(CONVEX_DIR)) {
      const source = readFileSync(file, "utf8");
      if (source.includes("research_")) {
        offenders.push(path.relative(CONVEX_DIR, file));
      }
    }
    // The investor/research surface is private and lives only in
    // website/convex. This is a public repository; a `research_` table or
    // function reaching it publishes the shape of that surface.
    expect(offenders).toEqual([]);
  });

  it("scans a non-trivial number of convex files", () => {
    // A broken walker makes the assertion above vacuous.
    expect(convexFiles(CONVEX_DIR).length).toBeGreaterThan(30);
  });
});
