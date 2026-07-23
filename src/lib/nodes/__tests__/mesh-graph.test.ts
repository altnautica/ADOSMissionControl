/**
 * @module nodes/mesh-graph.test
 * @description The reach graph derives the fleet's wiring from per-node reach
 * inputs: a data-path edge to the sink for a directly-reached node, a relay
 * edge to the ground node for a relayed drone, a multi-hop chain that stays a
 * chain, and — the honesty rule — the verification the row proved travels onto
 * the edge unchanged, so an unverified link can never render confident.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { buildMeshGraph, MESH_GCS_ID, type MeshNodeInput } from "../mesh-graph";
import type {
  BearerVerification,
  NodeBearerChip,
  NodeBearerKind,
} from "../node-bearer";

function chip(
  kind: NodeBearerKind,
  verification: BearerVerification,
  rssiDbm: number | null = null,
): NodeBearerChip {
  return { kind, viaName: null, verification, rssiDbm };
}

function input(over: Partial<MeshNodeInput> & { id: string }): MeshNodeInput {
  return {
    name: over.id,
    profile: "drone",
    liveness: "live",
    isRelayed: false,
    reachedViaId: null,
    primary: chip("lan", "verified"),
    secondary: null,
    ...over,
  };
}

function edge(graph: ReturnType<typeof buildMeshGraph>, id: string) {
  return graph.edges.find((e) => e.id === id);
}

describe("buildMeshGraph", () => {
  it("draws a solid data path from a directly-reached node to the GCS", () => {
    const graph = buildMeshGraph([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
    ]);
    // The GCS is always a vertex; the node is the only other one.
    expect(graph.vertices.map((v) => v.id)).toContain(MESH_GCS_ID);
    const e = edge(graph, "node:gs:primary");
    expect(e).toMatchObject({
      from: "node:gs",
      to: MESH_GCS_ID,
      bearer: "lan",
      style: "data",
      verification: "verified",
      primary: true,
    });
  });

  it("draws a dashed relay edge from a relayed drone to its ground node", () => {
    const graph = buildMeshGraph([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -51),
      }),
    ]);
    const e = edge(graph, "node:drone:primary");
    expect(e).toMatchObject({
      from: "node:drone",
      to: "node:gs", // the relay hop, not the GCS
      bearer: "wfb",
      style: "relay",
      verification: "verified",
    });
  });

  it("keeps a multi-hop relay chain a chain, hop by hop, ending at the GCS", () => {
    const graph = buildMeshGraph([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:relay",
        name: "Relay-A",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -55),
      }),
      input({
        id: "node:far",
        name: "Far-B",
        isRelayed: true,
        reachedViaId: "node:relay",
        primary: chip("wfb", "verified", -70),
      }),
    ]);
    expect(edge(graph, "node:gs:primary")?.to).toBe(MESH_GCS_ID);
    expect(edge(graph, "node:relay:primary")?.to).toBe("node:gs");
    expect(edge(graph, "node:far:primary")?.to).toBe("node:relay");
  });

  it("carries an unverified relay through unchanged — never upgraded to verified", () => {
    const graph = buildMeshGraph([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        // No received-side signal → the row proved only "unverified".
        primary: chip("wfb", "unverified"),
      }),
    ]);
    const e = edge(graph, "node:drone:primary");
    expect(e?.verification).toBe("unverified");
    expect(e?.style).toBe("relay");
  });

  it("carries a stale relay through as stale, not live", () => {
    const graph = buildMeshGraph([
      input({
        id: "node:drone",
        name: "Drone-D",
        liveness: "stale",
        isRelayed: true,
        reachedViaId: "node:gs", // ground node off-screen this render
        primary: chip("wfb", "stale", -60),
      }),
    ]);
    const e = edge(graph, "node:drone:primary");
    expect(e?.verification).toBe("stale");
    // Ground node is not in view, so the relay falls back to the sink.
    expect(e?.to).toBe(MESH_GCS_ID);
  });

  it("emits an alternate relay edge for a directly-reached node also carried over WFB", () => {
    const graph = buildMeshGraph([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        reachedViaId: "node:gs",
        primary: chip("lan", "verified"),
        secondary: chip("wfb", "unverified"),
      }),
    ]);
    // Primary: the direct LAN data path home.
    expect(edge(graph, "node:drone:primary")).toMatchObject({
      to: MESH_GCS_ID,
      bearer: "lan",
      style: "data",
      primary: true,
    });
    // Alternate: the WFB relay through the ground node — the multi-path.
    expect(edge(graph, "node:drone:secondary")).toMatchObject({
      to: "node:gs",
      bearer: "wfb",
      style: "relay",
      primary: false,
    });
  });
});
