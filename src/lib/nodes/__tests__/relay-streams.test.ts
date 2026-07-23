/**
 * @module nodes/relay-streams.test
 * @description The relay-streams list reads the fleet's funnels back out of the
 * reach graph the map draws: it names a multi-hop path end to end hop by hop,
 * collapses a funnel whose ground node is off-screen to a single hop home,
 * reports a fully-verified funnel as live and — the honesty rule — a stale one
 * as stale, never as a live path.
 *
 * @license GPL-3.0-only
 */

import { describe, it, expect } from "vitest";

import { buildMeshGraph, MESH_GCS_ID, type MeshNodeInput } from "../mesh-graph";
import { buildRelayStreams } from "../relay-streams";
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

/** The streams for a graph built from these inputs. */
function streamsFor(inputs: MeshNodeInput[]) {
  return buildRelayStreams(buildMeshGraph(inputs));
}

describe("buildRelayStreams", () => {
  it("names a multi-hop funnel end to end, hop by hop, ending at the GCS", () => {
    const streams = streamsFor([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:relay",
        name: "Charlie-03",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -55),
      }),
      input({
        id: "node:far",
        name: "Delta-04",
        isRelayed: true,
        reachedViaId: "node:relay",
        primary: chip("wfb", "verified", -70),
      }),
    ]);

    // One funnel per relayed node — the two relay leaves.
    const far = streams.find((s) => s.id === "node:far")!;
    expect(far.hops.map((h) => [h.fromName, h.bearer, h.toName])).toEqual([
      ["Delta-04", "wfb", "Charlie-03"],
      ["Charlie-03", "wfb", "GS-A"],
      ["GS-A", "lan", "GCS"],
    ]);
    // The path terminates at the sink and every leg is drawn as its own style.
    expect(far.hops[far.hops.length - 1].toId).toBe(MESH_GCS_ID);
    expect(far.hops.map((h) => h.style)).toEqual(["relay", "relay", "data"]);
  });

  it("funnels a single relayed drone through its ground node to the GCS", () => {
    const streams = streamsFor([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -51),
      }),
    ]);
    expect(streams).toHaveLength(1);
    expect(streams[0].hops.map((h) => h.toName)).toEqual(["GS-A", "GCS"]);
    expect(streams[0].live).toBe(true);
    expect(streams[0].worst).toBe("verified");
  });

  it("is live only when every hop is verified", () => {
    const [stream] = streamsFor([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -51),
      }),
    ]);
    expect(stream.live).toBe(true);
  });

  it("carries a stale relay through as stale, never as a live stream", () => {
    const [stream] = streamsFor([
      input({
        id: "node:drone",
        name: "Drone-D",
        liveness: "stale",
        isRelayed: true,
        reachedViaId: "node:gs", // ground node off-screen this render
        primary: chip("wfb", "stale", -60),
      }),
    ]);
    expect(stream.live).toBe(false);
    expect(stream.worst).toBe("stale");
    // Its ground node is not in view, so the funnel collapses to one hop home.
    expect(stream.hops).toHaveLength(1);
    expect(stream.hops[0].toId).toBe(MESH_GCS_ID);
  });

  it("reports the weakest hop as the funnel's state", () => {
    const [stream] = streamsFor([
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:drone",
        name: "Drone-D",
        isRelayed: true,
        reachedViaId: "node:gs",
        // The relay leg was never confirmed, though the ground node's LAN is.
        primary: chip("wfb", "unverified"),
      }),
    ]);
    expect(stream.live).toBe(false);
    expect(stream.worst).toBe("unverified");
  });

  it("draws no stream for a fleet reached entirely directly", () => {
    expect(
      streamsFor([
        input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
        input({ id: "node:a", name: "A", primary: chip("lan", "verified") }),
        input({ id: "node:b", name: "B", primary: chip("cloud", "verified") }),
      ]),
    ).toEqual([]);
  });

  it("holds one stream per relayed node, matching the map's relay count", () => {
    const inputs = [
      input({ id: "node:gs", name: "GS-A", profile: "ground-station" }),
      input({
        id: "node:d1",
        name: "D1",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -50),
      }),
      input({
        id: "node:d2",
        name: "D2",
        isRelayed: true,
        reachedViaId: "node:gs",
        primary: chip("wfb", "verified", -60),
      }),
    ];
    const graph = buildMeshGraph(inputs);
    const relayEdges = graph.edges.filter(
      (e) => e.style === "relay" && e.primary,
    ).length;
    expect(buildRelayStreams(graph)).toHaveLength(relayEdges);
  });
});
