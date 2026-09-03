/**
 * @module cmdMcpReach
 * @description The machine-credential-authenticated reach surface for the ADOS
 * MCP server. The server (run by the operator on their own machine) presents its
 * opaque credential; each action hashes it, looks the credential up, checks it is
 * live (not revoked, not expired), enforces a coarse scope class, resolves the
 * owning user, and performs the same fleet reach the browser-authed
 * `cmdDroneStatus` / `cmdDroneCommands` functions do — scoped to that user.
 *
 * This exists because a headless server cannot safely hold a browser refresh
 * token (rotating, single-consumer; a second consumer logs the operator's browser
 * out). The credential never touches the auth session.
 *
 * The coarse scope check here is defense in depth: the MCP server is the policy
 * engine, but a credential used against Convex DIRECTLY is still bounded to its
 * scopes and its allowed nodes. The DB functions live in `cmdMcpReachDb` so these
 * actions can call them without same-module circular type inference.
 *
 * @license GPL-3.0-only
 */

import { v } from "convex/values";
import { action } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  relayCommandValidator,
  requiredScopeForCommand,
  type RelayCommandName,
} from "./commandVocabulary";

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

interface Authorized {
  userId: string;
  scopes: string[];
  allowedNodes: string[];
  tokenId: string;
}

interface ReachNode {
  drone: {
    deviceId: string;
    name?: string;
    agentVersion?: string;
    board?: string;
    tier?: number;
    os?: string;
    mdnsHost?: string;
    lastIp?: string;
    lastSeen?: number;
    fcConnected?: boolean;
  };
  status: unknown;
}

/**
 * Raised when a credential is not live. A NAMED class, because
 * `verifyCredential` has to tell "this credential is invalid" apart from "the
 * backend broke" — a bare `catch {}` there reported both as `null`, so an MCP
 * server could not distinguish a rejected token from an outage, and neither
 * could anyone reading the logs.
 */
class CredentialRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialRejected";
  }
}

/**
 * Verify a presented credential is live (not revoked, not expired) and resolve its
 * principal. Throws on an invalid, revoked, or expired credential. Touches
 * lastUsedAt. Per-command scope enforcement is done by `assertCommandScope`, and
 * the node allowlist by `assertNodeAllowed`, so a read only needs a live credential.
 *
 * Every call charges a rate-limit attempt BEFORE the lookup and clears it after
 * a live credential resolves. This whole surface is a set of public actions
 * taking a bearer string, so without a lockout it is a free, unlimited oracle
 * for guessing one.
 */
async function authorize(ctx: ActionCtx, credential: string): Promise<Authorized> {
  await ctx.runMutation(internal.cmdMcpReachDb.consumeCredentialAttempt, {
    credential,
  });
  const tokenHash = await sha256Hex(credential);
  const row = await ctx.runQuery(internal.cmdMcpReachDb.lookupByHash, { tokenHash });
  if (!row || row.revokedAt || (row.expiresAt !== undefined && row.expiresAt < Date.now())) {
    throw new CredentialRejected("invalid or revoked credential");
  }
  await ctx.runMutation(internal.cmdMcpReachDb.touchLastUsed, { id: row._id });
  await ctx.runMutation(internal.cmdMcpReachDb.clearCredentialAttempts, {
    credential,
  });
  return {
    userId: row.userId,
    scopes: row.scopes,
    allowedNodes: row.allowedNodes,
    tokenId: row.tokenId,
  };
}

/**
 * Enforce that the credential holds the scope class the relay command requires.
 * Scope classes are non-hierarchical groups (admin does NOT imply flight), so a
 * plain membership check is correct: a `["read","safe_write","admin"]` credential
 * fails the `flight` requirement of an arm/takeoff `send_command`.
 */
function assertCommandScope(auth: Authorized, command: RelayCommandName, args: unknown): void {
  const required = requiredScopeForCommand(command, args);
  if (!auth.scopes.includes(required)) {
    throw new Error(`credential lacks the ${required} scope for ${command}`);
  }
}

/**
 * One audit event the MCP server mirrors to the cloud. Lean and already-redacted
 * (the full argument map stays in the server's local file + the agent log store).
 * `tokenId` is NOT accepted from the client — the action stamps the server-verified
 * credential's tokenId so the row correlates with the operator's own credential list.
 */
const mcpAuditEventValidator = v.object({
  tool: v.string(),
  node: v.string(),
  decision: v.union(
    v.literal("allowed"),
    v.literal("denied"),
    v.literal("confirmed"),
    v.literal("operator_absent"),
  ),
  result: v.string(),
  plane: v.union(v.literal("lan_direct"), v.literal("cloud_relay"), v.literal("on_box")),
  latencyMs: v.number(),
  tsUs: v.number(),
  mcpSession: v.optional(v.string()),
  argsRedacted: v.optional(v.boolean()),
  sensitiveRead: v.optional(v.boolean()),
  contentHash: v.string(),
});

/** Enforce the credential's node allowlist (empty = all the operator's nodes). */
function assertNodeAllowed(auth: Authorized, deviceId: string): void {
  if (auth.allowedNodes.length > 0 && !auth.allowedNodes.includes(deviceId)) {
    throw new Error("credential may not target this node");
  }
}

/**
 * Resolve a credential to its principal (for the server to build its auth
 * context). `null` means exactly one thing: the credential is not live.
 *
 * The blanket `catch {}` this replaces folded a lockout, a backend outage and a
 * schema error into the same `null` an invalid token returns, so an MCP server
 * saw "your credential is bad" for all four and an operator had nothing to act
 * on. Only `CredentialRejected` is answered with `null`; a lockout and every
 * other failure propagate as the errors they are.
 */
export const verifyCredential = action({
  args: { credential: v.string() },
  handler: async (ctx, { credential }): Promise<Authorized | null> => {
    try {
      return await authorize(ctx, credential);
    } catch (err) {
      if (err instanceof Error && err.name === "CredentialRejected") return null;
      throw err;
    }
  },
});

/** List the operator's cloud-connected nodes (filtered to the credential's allowlist). */
export const listNodes = action({
  args: { credential: v.string() },
  handler: async (ctx, { credential }): Promise<ReachNode[]> => {
    const auth = await authorize(ctx, credential);
    const rows = (await ctx.runQuery(internal.cmdMcpReachDb.listNodesForUser, {
      userId: auth.userId,
    })) as ReachNode[];
    if (auth.allowedNodes.length === 0) return rows;
    return rows.filter((r) => auth.allowedNodes.includes(r.drone.deviceId));
  },
});

/** Read one node's cloud status. */
export const getStatus = action({
  args: { credential: v.string(), deviceId: v.string() },
  handler: async (ctx, { credential, deviceId }): Promise<unknown> => {
    const auth = await authorize(ctx, credential);
    assertNodeAllowed(auth, deviceId);
    return await ctx.runQuery(internal.cmdMcpReachDb.getStatusForUser, {
      userId: auth.userId,
      deviceId,
    });
  },
});

/** Enqueue a relay command for one node (requires a write scope). */
export const enqueue = action({
  args: {
    credential: v.string(),
    deviceId: v.string(),
    command: relayCommandValidator,
    args: v.optional(v.any()),
  },
  handler: async (ctx, { credential, deviceId, command, args }): Promise<{ commandId: string }> => {
    const auth = await authorize(ctx, credential);
    assertNodeAllowed(auth, deviceId);
    assertCommandScope(auth, command, args);
    return (await ctx.runMutation(internal.cmdMcpReachDb.enqueueForUser, {
      userId: auth.userId,
      deviceId,
      command,
      args,
    })) as { commandId: string };
  },
});

/** Read the terminal state of an enqueued command (for the ack poll). */
export const getCommandStatus = action({
  args: { credential: v.string(), commandId: v.id("cmd_droneCommands") },
  handler: async (ctx, { credential, commandId }): Promise<unknown> => {
    const auth = await authorize(ctx, credential);
    const command = (await ctx.runQuery(internal.cmdMcpReachDb.getCommandForUser, {
      userId: auth.userId,
      commandId,
    })) as { deviceId?: string } | null;
    // getCommandForUser already enforces ownership; also enforce the credential's
    // node allowlist so a node-scoped credential cannot read another node's ack.
    if (command && typeof command.deviceId === "string") {
      assertNodeAllowed(auth, command.deviceId);
    }
    return command;
  },
});

/**
 * Mirror a batch of audit events to the cloud. Authorizes with "read" on purpose:
 * a denied write-attempt from a read-only credential must still be recorded, so
 * this must not require a write scope. The owning userId and the credential's
 * tokenId are taken from the verified credential, never from the client.
 */
export const recordAudit = action({
  args: {
    credential: v.string(),
    events: v.array(mcpAuditEventValidator),
  },
  handler: async (ctx, { credential, events }): Promise<{ inserted: number }> => {
    const auth = await authorize(ctx, credential);
    const capped = events.slice(0, 200);
    return (await ctx.runMutation(internal.cmdMcpReachDb.insertAuditEvents, {
      userId: auth.userId,
      tokenId: auth.tokenId,
      events: capped,
    })) as { inserted: number };
  },
});
