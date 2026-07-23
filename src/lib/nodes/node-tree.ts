/**
 * Fold the flat board rows into the reach hierarchy: a drone reached only
 * through a ground node's WFB relay nests under that ground node.
 *
 * The topology of the fleet is a tree of reach paths, not a flat list — a
 * transitively-enrolled drone belongs under the node that carries it. This is a
 * pure projection over the rows already on screen: a relayed row whose ground
 * node is also on screen becomes its child; a relayed row whose ground node is
 * filtered out (or absent) falls back to a root so it is never hidden. A
 * directly-reached node always stays at the top level, even when it also carries
 * WFB provenance — its own link is the reach it is grouped by.
 *
 * The output is the same rows in the same relative order, re-sequenced so each
 * parent is immediately followed by its children and annotated with a depth, so
 * a table can render the nesting without a second data source.
 *
 * @module nodes/node-tree
 * @license GPL-3.0-only
 */

import type { NodeRowModel } from "@/lib/nodes/node-rows";

/** One row in the flattened tree: the row, its nesting depth, and whether it
 * carries children (so a parent can render a group affordance). */
export interface NodeTreeRow {
  row: NodeRowModel;
  /** 0 for a top-level node, +1 per level of relay nesting. */
  depth: number;
  hasChildren: boolean;
}

/**
 * Build the nested, depth-annotated row order from the flat, already-ordered
 * board rows. Children keep their parents' relative order; a relayed row with no
 * on-screen parent is emitted as a root; a relay cycle degrades to flat roots
 * rather than looping.
 */
export function buildNodeTree(rows: readonly NodeRowModel[]): NodeTreeRow[] {
  const byId = new Map(rows.map((r) => [r.node._id, r]));
  const childrenByParent = new Map<string, NodeRowModel[]>();
  const claimed = new Set<string>();

  for (const r of rows) {
    // Only a relayed-only row nests; a directly-reached row with secondary WFB
    // provenance stays top-level (it is grouped by its own direct reach).
    const parentId = r.node.isRelayed ? r.node.reachedVia : undefined;
    if (!parentId || parentId === r.node._id) continue;
    const parent = byId.get(parentId);
    if (!parent) continue; // ground node not on screen → row falls back to root
    const siblings = childrenByParent.get(parentId) ?? [];
    siblings.push(r);
    childrenByParent.set(parentId, siblings);
    claimed.add(r.node._id);
  }

  const out: NodeTreeRow[] = [];
  const visited = new Set<string>();

  function emit(r: NodeRowModel, depth: number): void {
    if (visited.has(r.node._id)) return; // cycle guard
    visited.add(r.node._id);
    const children = childrenByParent.get(r.node._id) ?? [];
    out.push({ row: r, depth, hasChildren: children.length > 0 });
    for (const child of children) emit(child, depth + 1);
  }

  // Roots first, in the input order; each root pulls its subtree in behind it.
  for (const r of rows) {
    if (claimed.has(r.node._id)) continue;
    emit(r, 0);
  }
  // A claimed row never reached (its parent sat in a cycle) is still shown, flat.
  for (const r of rows) {
    if (!visited.has(r.node._id)) emit(r, 0);
  }

  return out;
}
