/**
 * @module cmdMcpTokens
 * @description Issuer for the ADOS MCP machine credential. An operator mints one
 * scoped, revocable, opaque credential in the Mission Control MCP tab and pastes
 * it into the MCP server they run on their own machine. The credential is the AI
 * client's bearer AND the credential the server presents to reach the operator's
 * fleet (verified in `cmdMcpReach`).
 *
 * The credential is an opaque random secret (`ados_mc_<b64url>`), never stored;
 * only its SHA-256 hash is persisted in `cmd_mcpTokens`, so a database read cannot
 * recover a usable credential. The plaintext is returned exactly once, at mint.
 * Revocation is a row flag (`revokedAt`), so a credential is killed instantly
 * without touching the operator's browser session.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

/** URL-safe base64 with no padding. */
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Hex SHA-256 of a string, using Web Crypto (available in Convex actions). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The scope classes a credential may carry. `mint` rejects anything outside this
 * set so a hand-crafted mint call cannot smuggle an unknown scope past the reach
 * gate. flight/destructive are accepted (inert until the flight plane ships) so a
 * credential CAN hold the scope the reach gate requires; the UI preset picker
 * still withholds them from the wizard.
 */
const SCOPE_VOCABULARY = [
  "read",
  "safe_write",
  "admin",
  "flight",
  "destructive",
  "secret_read",
] as const;

export interface MintResult {
  /** The plaintext credential. Returned once, never stored or logged. */
  credential: string;
  tokenId: string;
  expiresAt: number | null;
}

/**
 * Mint a machine credential for the authenticated operator. Runs as an action so
 * it can use Web Crypto for the random secret; the row is written via an internal
 * mutation so the secret never leaves the action.
 */
export const mint = action({
  args: {
    label: v.string(),
    scopes: v.array(v.string()),
    allowedNodes: v.optional(v.array(v.string())),
    ttlMs: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<MintResult> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const unknown = args.scopes.filter((s) => !(SCOPE_VOCABULARY as readonly string[]).includes(s));
    if (unknown.length > 0) throw new Error(`unknown scope(s): ${unknown.join(", ")}`);

    const secret = `ados_mc_${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
    const tokenHash = await sha256Hex(secret);
    const tokenId = `mct_${b64url(crypto.getRandomValues(new Uint8Array(9)))}`;
    const expiresAt = typeof args.ttlMs === "number" && args.ttlMs > 0 ? Date.now() + args.ttlMs : null;

    await ctx.runMutation(internal.cmdMcpTokens.insert, {
      userId,
      tokenId,
      tokenHash,
      scopes: args.scopes,
      allowedNodes: args.allowedNodes ?? [],
      label: args.label,
      ...(expiresAt !== null ? { expiresAt } : {}),
    });

    return { credential: secret, tokenId, expiresAt };
  },
});

/** Internal: persist a minted credential's hash + metadata. */
export const insert = internalMutation({
  args: {
    userId: v.string(),
    tokenId: v.string(),
    tokenHash: v.string(),
    scopes: v.array(v.string()),
    allowedNodes: v.array(v.string()),
    label: v.string(),
    expiresAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("cmd_mcpTokens", { ...args, createdAt: Date.now() });
  },
});

/** List the authenticated operator's credentials (metadata only, never the hash). */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("cmd_mcpTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
    return rows.map((r) => ({
      _id: r._id,
      tokenId: r.tokenId,
      scopes: r.scopes,
      allowedNodes: r.allowedNodes,
      label: r.label,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt ?? null,
      revokedAt: r.revokedAt ?? null,
      lastUsedAt: r.lastUsedAt ?? null,
    }));
  },
});

/**
 * The authenticated operator's most-recent MCP audit events (newest first). The
 * tab filters client-side; the query returns a bounded window scoped to the user.
 */
export const recentAuditEvents = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const cap = Math.min(Math.max(limit ?? 200, 1), 500);
    const rows = await ctx.db
      .query("cmd_mcpAuditEvents")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .take(cap);
    return rows.map((r) => ({
      _id: r._id,
      tokenId: r.tokenId,
      tool: r.tool,
      node: r.node,
      decision: r.decision,
      result: r.result,
      plane: r.plane,
      latencyMs: r.latencyMs,
      tsUs: r.tsUs,
      createdAt: r.createdAt,
      argsRedacted: r.argsRedacted ?? false,
      sensitiveRead: r.sensitiveRead ?? false,
    }));
  },
});

/** Revoke one of the operator's credentials by tokenId (instant, irreversible). */
export const revoke = mutation({
  args: { tokenId: v.string() },
  handler: async (ctx, { tokenId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const row = await ctx.db
      .query("cmd_mcpTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("tokenId"), tokenId))
      .first();
    if (!row) throw new Error("Not found");
    if (!row.revokedAt) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    return { ok: true };
  },
});

/** MCP audit rows are kept for 30 days. */
const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** Bounded so a backlog cannot blow the per-call limits. */
const AUDIT_PRUNE_BATCH = 256;

/**
 * Cron job: delete MCP audit rows past the retention window.
 *
 * One row per MCP tool call, append-only, with no natural end -- the highest
 * write cadence of the two event tables and previously swept by nothing. Reads
 * through `by_createdAt` so the cost tracks what is deleted, not the table.
 *
 * Retention is deliberate, not incidental: the audit trail is what an operator
 * reviews after an incident, so 30 days has to survive a sweep that runs daily.
 */
export const pruneOldAuditEvents = internalMutation({
  args: {},
  handler: async (ctx): Promise<{ deleted: number }> => {
    const cutoff = Date.now() - AUDIT_RETENTION_MS;
    const stale = await ctx.db
      .query("cmd_mcpAuditEvents")
      .withIndex("by_createdAt", (q) => q.lt("createdAt", cutoff))
      .take(AUDIT_PRUNE_BATCH);
    for (const row of stale) {
      await ctx.db.delete(row._id);
    }
    // A full batch means more may be past retention: keep draining now rather
    // than letting the backlog outgrow one batch per cron tick.
    if (stale.length === AUDIT_PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.cmdMcpTokens.pruneOldAuditEvents, {});
    }
    return { deleted: stale.length };
  },
});
