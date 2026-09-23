/**
 * ADOS MCP machine-credential tests.
 *
 * The credential is the operator's fleet reach + the AI client's bearer, so the
 * gates that bound it (scope class, revocation, expiry, node allowlist) and the
 * public-surface shape (mint returns the plaintext once; the DB functions are
 * internal, never client-callable) must hold.
 *
 * convex-test is not a dependency here, so this follows the established
 * tests/convex pattern: (1) source-reading pins the public surface, (2) a
 * faithful re-implementation of the authorize logic runs against fake rows.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { requiredScopeForCommand } from "../../convex/commandVocabulary";

const TOKENS_PATH = path.join(process.cwd(), "convex/cmdMcpTokens.ts");
const REACH_PATH = path.join(process.cwd(), "convex/cmdMcpReach.ts");
const REACH_DB_PATH = path.join(process.cwd(), "convex/cmdMcpReachDb.ts");

// ── Re-implementation of the cmdMcpReach authorize/allowlist logic ──────────
// authorize() now only asserts liveness; per-command scope is a separate gate.

const SCOPE_VOCABULARY = ["read", "safe_write", "admin", "flight", "destructive", "secret_read"];

interface Row {
  scopes: string[];
  allowedNodes: string[];
  revokedAt?: number;
  expiresAt?: number;
}

function authorize(row: Row | null, now: number): { ok: boolean; reason?: string } {
  if (!row || row.revokedAt || (row.expiresAt !== undefined && row.expiresAt < now)) {
    return { ok: false, reason: "invalid or revoked credential" };
  }
  return { ok: true };
}

/** The enqueue scope gate: does the credential hold the command's required class? */
function commandScopeOk(scopes: string[], command: Parameters<typeof requiredScopeForCommand>[0], args: unknown): boolean {
  const required = requiredScopeForCommand(command, args);
  // A payload that is not a command the agent accepts ("null class" for an
  // unknown verb) can never be granted, mirroring assertCommandScope.
  if (required === null) return false;
  return scopes.includes(required);
}

/** The mint scope-vocabulary gate. */
function mintScopesOk(scopes: string[]): boolean {
  return scopes.every((s) => SCOPE_VOCABULARY.includes(s));
}

function nodeAllowed(allowedNodes: string[], deviceId: string): boolean {
  return allowedNodes.length === 0 || allowedNodes.includes(deviceId);
}

// ── Re-implementation of the audit-mirror insert/read logic ─────────────────

interface AuditRow {
  contentHash: string;
  createdAt: number;
}

/** Idempotent batch insert: an event whose contentHash already exists is skipped. */
function insertAuditEvents(existing: AuditRow[], events: { contentHash: string }[]): { inserted: number; rows: AuditRow[] } {
  const rows = [...existing];
  const seen = new Set(rows.map((r) => r.contentHash));
  let inserted = 0;
  for (const e of events) {
    if (seen.has(e.contentHash)) continue;
    seen.add(e.contentHash);
    rows.push({ contentHash: e.contentHash, createdAt: NOW });
    inserted++;
  }
  return { inserted, rows };
}

/** The recentAuditEvents read cap: clamp the requested limit to [1, 500], default 200. */
function auditReadCap(limit?: number): number {
  return Math.min(Math.max(limit ?? 200, 1), 500);
}

const NOW = 1_800_000_000_000;
const live: Row = { scopes: ["read", "admin"], allowedNodes: [] };

describe("cmdMcpReach authorize logic", () => {
  it("accepts a live credential", () => {
    expect(authorize(live, NOW).ok).toBe(true);
  });

  it("rejects a revoked credential", () => {
    expect(authorize({ ...live, revokedAt: NOW - 1 }, NOW).ok).toBe(false);
  });

  it("rejects an expired credential but accepts one still in date", () => {
    expect(authorize({ ...live, expiresAt: NOW - 1 }, NOW).ok).toBe(false);
    expect(authorize({ ...live, expiresAt: NOW + 1000 }, NOW).ok).toBe(true);
  });

  it("rejects a missing credential (bad hash lookup)", () => {
    expect(authorize(null, NOW).ok).toBe(false);
  });

  it("enforces the node allowlist (empty = all owned nodes)", () => {
    expect(nodeAllowed([], "any-node")).toBe(true);
    expect(nodeAllowed(["n1", "n2"], "n1")).toBe(true);
    expect(nodeAllowed(["n1", "n2"], "n3")).toBe(false);
  });
});

describe("cmdMcpReach per-command scope enforcement (the direct-Convex backstop)", () => {
  const operate = ["read", "safe_write", "admin"]; // the "Operate" preset
  const flightCred = ["read", "safe_write", "admin", "flight"];

  it("rejects a flight-shaped send_command from an Operate credential", () => {
    expect(commandScopeOk(operate, "send_command", { cmd: "arm" })).toBe(false);
    expect(commandScopeOk(operate, "send_command", { cmd: "takeoff" })).toBe(false);
  });

  it("allows a flight-shaped send_command only with the flight scope", () => {
    expect(commandScopeOk(flightCred, "send_command", { cmd: "arm" })).toBe(true);
  });

  it("refuses a send_command verb the agent does not accept, for every credential", () => {
    expect(commandScopeOk(operate, "send_command", { cmd: "get_battery" })).toBe(false);
    expect(commandScopeOk([...flightCred, "destructive"], "send_command", { cmd: "get_battery" })).toBe(false);
    expect(commandScopeOk(flightCred, "send_command", { cmd: "constructor" })).toBe(false);
  });

  it("gates admin ops on the admin scope and read pulls on read", () => {
    expect(commandScopeOk(["read"], "restart_service", {})).toBe(false);
    expect(commandScopeOk(["read", "admin"], "restart_service", {})).toBe(true);
    expect(commandScopeOk(["read"], "get_logs", {})).toBe(true);
  });
});

describe("cmdMcpTokens mint scope-vocabulary validation", () => {
  it("rejects an out-of-vocabulary scope", () => {
    expect(mintScopesOk(["read", "admin", "made_up"])).toBe(false);
  });

  it("accepts the known scopes, including inert flight/destructive", () => {
    expect(mintScopesOk(["read"])).toBe(true);
    expect(mintScopesOk(["read", "flight", "destructive"])).toBe(true);
    expect(mintScopesOk(["read", "safe_write", "admin", "secret_read"])).toBe(true);
  });
});

describe("cmdMcpReach getCommandStatus node scoping", () => {
  it("rejects reading an ack for a node outside the allowlist", () => {
    // getCommandStatus fetches the command then asserts the node allowlist.
    expect(nodeAllowed(["n1"], "n2")).toBe(false); // command.deviceId=n2, cred scoped to n1
    expect(nodeAllowed(["n1"], "n1")).toBe(true);
    expect(nodeAllowed([], "n2")).toBe(true); // empty allowlist = all owned
  });
});

describe("cmdMcpTokens / cmdMcpReach public surface", () => {
  it("mint is an action; listMine a query; revoke a mutation; insert internal-only", async () => {
    const src = await readFile(TOKENS_PATH, "utf8");
    expect(src).toMatch(/export const mint = action\(/);
    expect(src).toMatch(/export const listMine = query\(/);
    expect(src).toMatch(/export const revoke = mutation\(/);
    expect(src).toMatch(/export const insert = internalMutation\(/);
    // the plaintext credential is returned, and only its hash is stored
    expect(src).toMatch(/return \{ credential: secret/);
    expect(src).toMatch(/tokenHash/);
    expect(src).not.toMatch(/secret: secret/); // never persists the plaintext
    // mint validates the requested scopes against the known vocabulary
    expect(src).toMatch(/SCOPE_VOCABULARY/);
    expect(src).toMatch(/unknown scope/);
  });

  it("the reach entrypoints are actions that authorize + scope-gate before acting", async () => {
    const src = await readFile(REACH_PATH, "utf8");
    for (const fn of ["verifyCredential", "listNodes", "getStatus", "enqueue", "getCommandStatus", "recordAudit"]) {
      expect(src).toMatch(new RegExp(`export const ${fn} = action\\(`));
    }
    // authorize no longer carries a coarse read/write need; the write gate is
    // per-command (assertCommandScope) and the coarse WRITE_SCOPES set is gone.
    expect(src).toMatch(/await authorize\(ctx, credential\)/);
    expect(src).not.toMatch(/authorize\(ctx, credential, "write"\)/);
    expect(src).not.toMatch(/WRITE_SCOPES/);
    // enqueue enforces the per-command scope class; getCommandStatus enforces the
    // node allowlist on the fetched command.
    expect(src).toMatch(/assertCommandScope\(auth, command, args\)/);
    const getCmdStatus = src.slice(src.indexOf("export const getCommandStatus"));
    expect(getCmdStatus).toMatch(/assertNodeAllowed\(auth, command\.deviceId\)/);
    // no internal (client-uncallable) DB function is exported from the action module
    expect(src).not.toMatch(/internalQuery\(/);
    expect(src).not.toMatch(/internalMutation\(/);
  });

  it("the DB functions are internal-only and scoped to the resolved userId", async () => {
    const src = await readFile(REACH_DB_PATH, "utf8");
    for (const fn of ["lookupByHash", "listNodesForUser", "getStatusForUser", "getCommandForUser"]) {
      expect(src).toMatch(new RegExp(`export const ${fn} = internalQuery\\(`));
    }
    for (const fn of ["touchLastUsed", "enqueueForUser", "insertAuditEvents"]) {
      expect(src).toMatch(new RegExp(`export const ${fn} = internalMutation\\(`));
    }
    // reads/writes are scoped to the resolved userId (ownership check)
    expect(src).toMatch(/drone\.userId !== userId/);
    expect(src).toMatch(/command\.userId !== userId/);
    // no client-callable (query/mutation/action) export leaks here
    expect(src).not.toMatch(/= (query|mutation|action)\(/);
  });
});

describe("cmdMcpReach audit mirror", () => {
  it("skips an event whose contentHash already exists (idempotent re-push)", () => {
    const first = insertAuditEvents([], [{ contentHash: "a" }, { contentHash: "b" }]);
    expect(first.inserted).toBe(2);
    // a retry with an overlapping batch inserts only the new one
    const second = insertAuditEvents(first.rows, [{ contentHash: "b" }, { contentHash: "c" }]);
    expect(second.inserted).toBe(1);
    expect(second.rows).toHaveLength(3);
  });

  it("clamps the read window to [1, 500] with a default of 200", () => {
    expect(auditReadCap(undefined)).toBe(200);
    expect(auditReadCap(0)).toBe(1);
    expect(auditReadCap(50)).toBe(50);
    expect(auditReadCap(10_000)).toBe(500);
  });

  it("recordAudit only asserts liveness (a denied write must still be audited) and stamps the server tokenId", async () => {
    const src = await readFile(REACH_PATH, "utf8");
    // recordAudit must NOT require a write scope — a read-only credential's denied
    // write is exactly the event we want recorded. authorize() = liveness only.
    const block = src.slice(src.indexOf("export const recordAudit"));
    expect(block).toMatch(/authorize\(ctx, credential\)/);
    // the owning userId + credential tokenId come from the verified credential
    expect(block).toMatch(/auth\.userId/);
    expect(block).toMatch(/auth\.tokenId/);
    // the batch is bounded
    expect(block).toMatch(/events\.slice\(0, 200\)/);
    // the client cannot supply its own tokenId FIELD in the event validator
    const validatorDef = src.slice(
      src.indexOf("const mcpAuditEventValidator = v.object("),
      src.indexOf("export const recordAudit"),
    );
    expect(validatorDef).toMatch(/tool: v\.string\(\)/);
    expect(validatorDef).not.toMatch(/tokenId: v\./);
  });

  it("recentAuditEvents is an operator-authed query that never returns the argument map", async () => {
    const src = await readFile(TOKENS_PATH, "utf8");
    expect(src).toMatch(/export const recentAuditEvents = query\(/);
    // bound the block to the function itself (the next export is `revoke`, whose
    // own `args:` declaration would otherwise leak into the projection check)
    const block = src.slice(
      src.indexOf("export const recentAuditEvents"),
      src.indexOf("export const revoke"),
    );
    expect(block).toMatch(/getAuthUserId/);
    expect(block).toMatch(/if \(!userId\) return \[\]/);
    expect(block).toMatch(/by_user_created/);
    // the lean returned projection never carries a raw args map (argsRedacted is a
    // boolean flag, not the argument values)
    const projection = block.slice(block.indexOf("rows.map("));
    expect(projection).not.toMatch(/\bargs:/);
    expect(projection).toMatch(/argsRedacted/);
  });
});
