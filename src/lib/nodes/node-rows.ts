/**
 * Row model for the fleet-operations board: one fleet node joined to its live
 * telemetry projection.
 *
 * Membership and telemetry live in two places on purpose. The membership entry
 * carries identity and pairing (name, device id, profile, credentials); the
 * per-node summary carries everything that moves (liveness, radio, battery,
 * mode). A board row needs both, so this module joins them by device id and
 * keeps the summary's ordering — live nodes first, then stale, then offline.
 *
 * A membership entry with no summary is impossible in practice (the summary
 * projection is built from the same list) but is dropped rather than rendered
 * half-filled, so a row never shows an identity with fabricated telemetry.
 *
 * @module nodes/node-rows
 * @license GPL-3.0-only
 */

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";

/** One board row: a node's identity plus its live state. */
export interface NodeRowModel {
  node: FleetNodeEntry;
  summary: CommandAgentSummary;
}

/**
 * Join fleet nodes to their summaries by device id, preserving the summary
 * ordering (live → stale → offline, then name).
 */
export function joinNodeRows(
  nodes: readonly FleetNodeEntry[],
  summaries: readonly CommandAgentSummary[],
): NodeRowModel[] {
  const byDeviceId = new Map(nodes.map((node) => [node.deviceId, node]));
  const rows: NodeRowModel[] = [];
  for (const summary of summaries) {
    const node = byDeviceId.get(summary.identity.deviceId);
    if (node) rows.push({ node, summary });
  }
  return rows;
}

/** True when `query` matches a node's display name, device id, or board. */
export function nodeMatchesQuery(node: FleetNodeEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    node.name.toLowerCase().includes(q) ||
    node.deviceId.toLowerCase().includes(q) ||
    (node.board?.toLowerCase().includes(q) ?? false)
  );
}
