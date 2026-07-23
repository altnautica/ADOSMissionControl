/**
 * Tests for the reach-hierarchy projection: a relayed drone nests under its
 * ground node, an orphaned relay falls back to a root rather than vanishing, a
 * directly-reached node stays top-level, and a relay cycle degrades to flat
 * roots instead of looping.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { buildNodeTree } from "@/lib/nodes/node-tree";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { CommandAgentSummary } from "@/hooks/use-command-agent-fleet";

/** A row carrying only the fields the tree projection reads. */
function row(
  deviceId: string,
  extra: Partial<FleetNodeEntry> = {},
): NodeRowModel {
  const node = {
    _id: `node:${deviceId}`,
    deviceId,
    name: deviceId,
    ...extra,
  } as FleetNodeEntry;
  return { node, summary: {} as CommandAgentSummary };
}

/** The (id, depth) sequence the tree produces, for terse assertions. */
function shape(rows: NodeRowModel[]): [string, number][] {
  return buildNodeTree(rows).map((t) => [t.row.node.deviceId, t.depth]);
}

describe("buildNodeTree", () => {
  it("nests a relayed drone under its ground node, right after it", () => {
    const rows = [
      row("gs-1", { profile: "ground-station" }),
      row("drone-a", { isRelayed: true, reachedVia: "node:gs-1" }),
    ];
    expect(shape(rows)).toEqual([
      ["gs-1", 0],
      ["drone-a", 1],
    ]);
  });

  it("keeps a directly-reached node top-level even with WFB provenance", () => {
    // reachedVia is present as secondary provenance, but the node is not relayed-
    // only, so it is grouped by its own direct reach — a root.
    const rows = [
      row("gs-1", { profile: "ground-station" }),
      row("drone-a", { reachedVia: "node:gs-1" }),
    ];
    expect(shape(rows)).toEqual([
      ["gs-1", 0],
      ["drone-a", 0],
    ]);
  });

  it("keeps two ground nodes' relayed drones under the right parent", () => {
    const rows = [
      row("gs-1", { profile: "ground-station" }),
      row("gs-2", { profile: "ground-station" }),
      row("drone-a", { isRelayed: true, reachedVia: "node:gs-1" }),
      row("drone-b", { isRelayed: true, reachedVia: "node:gs-2" }),
    ];
    expect(shape(rows)).toEqual([
      ["gs-1", 0],
      ["drone-a", 1],
      ["gs-2", 0],
      ["drone-b", 1],
    ]);
  });

  it("falls back to a root when the ground node is not on screen", () => {
    // The parent is filtered out, so the drone is shown flat rather than hidden.
    const rows = [row("drone-a", { isRelayed: true, reachedVia: "node:gs-1" })];
    expect(shape(rows)).toEqual([["drone-a", 0]]);
  });

  it("marks a parent as having children", () => {
    const rows = [
      row("gs-1", { profile: "ground-station" }),
      row("drone-a", { isRelayed: true, reachedVia: "node:gs-1" }),
    ];
    const tree = buildNodeTree(rows);
    expect(tree[0].hasChildren).toBe(true);
    expect(tree[1].hasChildren).toBe(false);
  });

  it("degrades a relay cycle to flat roots instead of looping", () => {
    const rows = [
      row("a", { isRelayed: true, reachedVia: "node:b" }),
      row("b", { isRelayed: true, reachedVia: "node:a" }),
    ];
    // Both claim each other as parent → neither is a plain root; the fallback
    // pass emits each exactly once without recursing forever.
    const ids = buildNodeTree(rows).map((t) => t.row.node.deviceId).sort();
    expect(ids).toEqual(["a", "b"]);
    expect(buildNodeTree(rows)).toHaveLength(2);
  });
});
