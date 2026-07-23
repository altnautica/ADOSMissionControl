/**
 * A deterministic radial layout for the reach graph.
 *
 * The GCS sits at the centre — the sink every path converges on — with the
 * fleet fanned out in rings around it: a node one hop away on the first ring, a
 * node reached through another node one ring further out, so distance from the
 * centre reads as distance from the GCS. Children fan out under their parent's
 * angle, so a ground node and the drones it relays stay a contiguous wedge
 * rather than scattering across the circle.
 *
 * Pure and coordinate-only: it takes a graph and a square canvas size and
 * returns a position per vertex, so the SVG that draws it holds no layout logic
 * and the placement is reproducible.
 *
 * @module nodes/mesh-layout
 * @license GPL-3.0-only
 */

import { MESH_GCS_ID, type MeshGraph } from "@/lib/nodes/mesh-graph";

export interface Point {
  x: number;
  y: number;
}

/** Angle at the top of the circle, so the first ring reads clockwise from 12. */
const TOP = -Math.PI / 2;

/**
 * Position every vertex of `graph` inside a `size`×`size` canvas. The GCS lands
 * at the centre; each node lands on the ring for its hop-distance from the GCS,
 * at an angle that keeps its subtree together. Cycles and off-tree vertices are
 * pinned to the first ring rather than dropped, so a vertex is never unplaced.
 */
export function layoutMeshGraph(
  graph: MeshGraph,
  size = 320,
): Map<string, Point> {
  const centre = size / 2;
  const margin = 40;
  const positions = new Map<string, Point>();
  positions.set(MESH_GCS_ID, { x: centre, y: centre });

  const vertexIds = new Set(graph.vertices.map((v) => v.id));

  // The primary edges form the reach tree rooted at the GCS: each node's parent
  // is where its primary path points. Secondary (alternate) edges never shape
  // the layout — a node sits under the path it is grouped by.
  const childrenByParent = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!edge.primary) continue;
    const parent = vertexIds.has(edge.to) ? edge.to : MESH_GCS_ID;
    const siblings = childrenByParent.get(parent) ?? [];
    siblings.push(edge.from);
    childrenByParent.set(parent, siblings);
  }
  // Stable child order so the layout is reproducible run to run.
  for (const siblings of childrenByParent.values()) siblings.sort();

  // Hop-distance from the GCS, breadth-first over the reach tree.
  const depth = new Map<string, number>([[MESH_GCS_ID, 0]]);
  const queue = [MESH_GCS_ID];
  let maxDepth = 0;
  while (queue.length > 0) {
    const id = queue.shift()!;
    const d = depth.get(id)!;
    for (const child of childrenByParent.get(id) ?? []) {
      if (depth.has(child)) continue; // cycle guard
      depth.set(child, d + 1);
      maxDepth = Math.max(maxDepth, d + 1);
      queue.push(child);
    }
  }
  // Any vertex the tree never reached (a relay cycle, an off-tree orphan) is
  // still placed: attach it to the GCS on the first ring.
  for (const vertex of graph.vertices) {
    if (depth.has(vertex.id)) continue;
    depth.set(vertex.id, 1);
    maxDepth = Math.max(maxDepth, 1);
    const siblings = childrenByParent.get(MESH_GCS_ID) ?? [];
    if (!siblings.includes(vertex.id)) siblings.push(vertex.id);
    childrenByParent.set(MESH_GCS_ID, siblings);
  }

  // Leaves carry the angular budget; an internal node takes the mean of its
  // children so a subtree stays a contiguous wedge under its parent.
  const leaves: string[] = [];
  (function collect(id: string, seen: Set<string>) {
    if (seen.has(id)) return;
    seen.add(id);
    const children = childrenByParent.get(id) ?? [];
    if (children.length === 0) {
      if (id !== MESH_GCS_ID) leaves.push(id);
      return;
    }
    for (const child of children) collect(child, seen);
  })(MESH_GCS_ID, new Set());
  const leafCount = Math.max(leaves.length, 1);

  const angle = new Map<string, number>();
  let leafIndex = 0;
  (function assign(id: string, seen: Set<string>): number {
    if (angle.has(id)) return angle.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const children = childrenByParent.get(id) ?? [];
    let a: number;
    if (children.length === 0) {
      a = id === MESH_GCS_ID ? 0 : ((leafIndex++ + 0.5) / leafCount) * Math.PI * 2;
    } else {
      const childAngles = children.map((c) => assign(c, seen));
      a = childAngles.reduce((sum, x) => sum + x, 0) / childAngles.length;
    }
    angle.set(id, a);
    return a;
  })(MESH_GCS_ID, new Set());

  const ringStep = maxDepth > 0 ? (centre - margin) / maxDepth : 0;
  for (const vertex of graph.vertices) {
    if (vertex.id === MESH_GCS_ID) continue;
    const r = (depth.get(vertex.id) ?? 1) * ringStep;
    const a = (angle.get(vertex.id) ?? 0) + TOP;
    positions.set(vertex.id, {
      x: centre + r * Math.cos(a),
      y: centre + r * Math.sin(a),
    });
  }

  return positions;
}
