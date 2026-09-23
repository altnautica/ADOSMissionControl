/**
 * @module components/mcp/mcp-scope-model
 * @description The "what can this credential do" resolver. Given a credential's
 * scopes + node allow-list and a tool descriptor, it answers whether the
 * credential could call the tool — a CLIENT-SIDE CAPABILITY CHECK, never a live
 * call (no fabricated reading). It mirrors the connector's gate (scope-group membership, the
 * flight-enforce hide, the agent-mode-only hide, the node allow-list) so the
 * credential-detail preview matches what the server would actually admit.
 * @license GPL-3.0-only
 */

/** A tool as the resolver needs it — from the committed catalog snapshot or a
 * plugin's parsed contribution. `scope` is the scope group the token must hold. */
export interface ScopeToolDescriptor {
  name: string;
  scope: string;
  safetyClass?: string;
  agentModeOnly?: boolean;
  affectsFlight?: boolean;
}

/** A credential as the resolver needs it (a subset of the minted-token row). */
export interface ScopeCredentialLike {
  scopes: string[];
  allowedNodes: string[];
}

/** The reach context: is flight enforcement on, are we fleet-mode, which node. */
export interface ScopeContext {
  /** True once the agent's MAVLink-proxy enforce flag is confirmed on. */
  flightEnforced: boolean;
  /** True in fleet (cloud) mode: agent-mode-only tools are unreachable. */
  fleetMode: boolean;
  /** The target node id, for the allow-list check. Omit to skip that gate. */
  node?: string;
}

/** Why a tool is not callable by a credential. */
export type BlockReason = "scope" | "flight_disabled" | "agent_mode_only" | "node_not_allowed";

export interface CanCallResult {
  callable: boolean;
  reason?: BlockReason;
}

/**
 * Whether `cred` could call `tool` in `ctx`. Checks, in the order the connector
 * applies them so the FIRST failing gate is the reported reason:
 *   1. scope    — the token must hold the tool's scope group.
 *   2. flight   — a flight tool (or one that affects flight) is hidden until the
 *                 MAVLink-proxy enforce flag is on.
 *   3. agent    — an agent-mode-only tool cannot be served over the fleet relay.
 *   4. node     — a node-scoped token can only reach a node in its allow-list.
 */
export function canCredentialCallTool(
  cred: ScopeCredentialLike,
  tool: ScopeToolDescriptor,
  ctx: ScopeContext,
): CanCallResult {
  if (!cred.scopes.includes(tool.scope)) {
    return { callable: false, reason: "scope" };
  }
  if ((tool.scope === "flight" || tool.affectsFlight) && !ctx.flightEnforced) {
    return { callable: false, reason: "flight_disabled" };
  }
  if (tool.agentModeOnly && ctx.fleetMode) {
    return { callable: false, reason: "agent_mode_only" };
  }
  if (
    ctx.node !== undefined &&
    cred.allowedNodes.length > 0 &&
    !cred.allowedNodes.includes(ctx.node)
  ) {
    return { callable: false, reason: "node_not_allowed" };
  }
  return { callable: true };
}

export interface CredentialReachSummary {
  callable: number;
  blocked: number;
  total: number;
  /** Blocked counts by reason, for a per-class breakdown in the detail drawer. */
  byReason: Record<BlockReason, number>;
}

/** Summarize a credential's reach across a set of tools (the detail preview). */
export function summarizeCredentialReach(
  cred: ScopeCredentialLike,
  tools: readonly ScopeToolDescriptor[],
  ctx: ScopeContext,
): CredentialReachSummary {
  const byReason: Record<BlockReason, number> = {
    scope: 0,
    flight_disabled: 0,
    agent_mode_only: 0,
    node_not_allowed: 0,
  };
  let callable = 0;
  for (const tool of tools) {
    const r = canCredentialCallTool(cred, tool, ctx);
    if (r.callable) callable += 1;
    else if (r.reason) byReason[r.reason] += 1;
  }
  return { callable, blocked: tools.length - callable, total: tools.length, byReason };
}
