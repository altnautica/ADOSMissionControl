/**
 * Radial reach-graph layout: a relayed drone must never be drawn on top of the
 * ground node it is relayed through, including when that ground node is out of
 * view and so has no path of its own to the GCS.
 * @license GPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { layoutMeshGraph } from "@/lib/nodes/mesh-layout";
import {
  MESH_GCS_ID,
  type MeshEdge,
  type MeshGraph,
  type MeshVertex,
} from "@/lib/nodes/mesh-graph";

const vertex = (id: string, kind: MeshVertex["kind"] = "node"): MeshVertex => ({
  id,
  kind,
  name: id,
  profile: null,
  liveness: null,
});

const edge = (from: string, to: string): MeshEdge =>
  ({ id: `${from}->${to}`, from, to, primary: true, style: "relay" }) as MeshEdge;

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("layoutMeshGraph", () => {
  it("places a drone relayed through an off-view ground node one ring beyond it", () => {
    const graph: MeshGraph = {
      vertices: [vertex(MESH_GCS_ID, "gcs"), vertex("gs-1", "offview"), vertex("drone-1")],
      // The off-view ground node has no path of its own; the drone points at it.
      edges: [edge("drone-1", "gs-1")],
    };
    const pos = layoutMeshGraph(graph, 320);
    const centre = pos.get(MESH_GCS_ID)!;
    const parent = pos.get("gs-1")!;
    const child = pos.get("drone-1")!;
    expect(distance(parent, child)).toBeGreaterThan(1);
    expect(distance(centre, child)).toBeGreaterThan(distance(centre, parent));
  });

  it("still places every vertex of a relay cycle", () => {
    const graph: MeshGraph = {
      vertices: [vertex(MESH_GCS_ID, "gcs"), vertex("a"), vertex("b")],
      edges: [edge("a", "b"), edge("b", "a")],
    };
    const pos = layoutMeshGraph(graph, 320);
    expect(pos.has("a")).toBe(true);
    expect(pos.has("b")).toBe(true);
  });
});
