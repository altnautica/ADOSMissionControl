/**
 * The fleet's relay streams: each funnel path a relayed node takes home, named
 * hop by hop.
 *
 * The mesh graph draws the fleet's wiring as vertices and edges. This reads
 * those same edges back into a list an operator (and assistive tech) can read
 * as sentences — "Drone-D over WFB to GS-A, then to GCS". It is the text
 * equivalent of the map, so it walks the very edges the map draws rather than
 * re-deriving reach a second, divergent way: a stream and its edge can never
 * disagree about a node's link (Rule 44).
 *
 * A funnel starts at a node whose OWN path home is a relay — the same
 * primary-relay edge the map counts as a relay stream — and follows that node's
 * reach up the tree, hop by hop, until it terminates at the GCS. So the list
 * holds exactly one stream per relayed node, and its count equals the map's
 * relay-stream count by construction.
 *
 * Honesty travels with each hop: a stream is "flowing" only when every hop is
 * verified — a received-side frame heard on each leg. A stream with any
 * unverified, stale, or down hop is carried through as exactly that, its overall
 * state the least-trustworthy hop, never dressed up as a live path (Rule 44 /
 * Rule 37). A directly-reached node draws no relay stream: it has no funnel.
 *
 * @module nodes/relay-streams
 * @license GPL-3.0-only
 */

import {
  MESH_GCS_ID,
  type MeshEdge,
  type MeshEdgeStyle,
  type MeshGraph,
  type MeshVertexKind,
} from "@/lib/nodes/mesh-graph";
import type { BearerVerification, NodeBearerKind } from "@/lib/nodes/node-bearer";

/** One leg of a funnel: the bearer carrying a node to the next vertex. */
export interface RelayHop {
  fromId: string;
  fromName: string;
  /** The next vertex up the path: a parent node, an off-view parent, or
   * {@link MESH_GCS_ID}. */
  toId: string;
  toName: string;
  /** The kind of the terminating vertex, so the text names an off-view relay
   * parent honestly rather than as a GCS peer link (Rule 44). */
  toKind: MeshVertexKind;
  bearer: NodeBearerKind;
  verification: BearerVerification;
  style: MeshEdgeStyle;
}

/** A funnel: one relayed node's full path home, terminating at the GCS. */
export interface RelayStream {
  /** The leaf node the funnel starts from. */
  id: string;
  leafName: string;
  hops: RelayHop[];
  /** True only when every hop is verified — a proven, live path home. */
  live: boolean;
  /** The least-trustworthy hop's verification: the honest overall state. */
  worst: BearerVerification;
}

/** How trustworthy each verification is, least first, so a funnel reports its
 * weakest leg rather than an average that would hide a broken one. */
const RANK: Record<BearerVerification, number> = {
  down: 0,
  stale: 1,
  unverified: 2,
  verified: 3,
};

/** The weakest verification across a funnel's hops. An empty funnel — which a
 * relay leaf never produces — reads "down" rather than a false "verified". */
function worstVerification(hops: readonly RelayHop[]): BearerVerification {
  if (hops.length === 0) return "down";
  let worst: BearerVerification = "verified";
  for (const hop of hops) {
    if (RANK[hop.verification] < RANK[worst]) worst = hop.verification;
  }
  return worst;
}

/** Walk one relayed node's path home, following its primary edge up the tree.
 * A visited set bounds a relay cycle so the walk always terminates. */
function walkStream(
  leafId: string,
  primaryBySource: ReadonlyMap<string, MeshEdge>,
  nameById: ReadonlyMap<string, string>,
  kindById: ReadonlyMap<string, MeshVertexKind>,
): RelayStream {
  const hops: RelayHop[] = [];
  const seen = new Set<string>();
  let cur: string | undefined = leafId;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const edge = primaryBySource.get(cur);
    if (!edge) break;
    hops.push({
      fromId: edge.from,
      fromName: nameById.get(edge.from) ?? edge.from,
      toId: edge.to,
      toName: nameById.get(edge.to) ?? edge.to,
      toKind: kindById.get(edge.to) ?? "node",
      bearer: edge.bearer,
      verification: edge.verification,
      style: edge.style,
    });
    if (edge.to === MESH_GCS_ID) break;
    cur = edge.to;
  }
  return {
    id: leafId,
    leafName: nameById.get(leafId) ?? leafId,
    hops,
    live: hops.length > 0 && hops.every((h) => h.verification === "verified"),
    worst: worstVerification(hops),
  };
}

/**
 * Read the fleet's relay streams out of its reach graph. Pure: the same graph
 * always produces the same streams, and each hop carries exactly the bearer and
 * verification the map's edge did — never upgraded. One stream per relayed node,
 * so the count mirrors the map's relay-stream summary.
 */
export function buildRelayStreams(graph: MeshGraph): RelayStream[] {
  const nameById = new Map(graph.vertices.map((v) => [v.id, v.name]));
  const kindById = new Map(graph.vertices.map((v) => [v.id, v.kind]));
  // A node has exactly one primary edge — its actual path home. Indexing them
  // lets a funnel be walked hop by hop up the reach tree.
  const primaryBySource = new Map<string, MeshEdge>();
  for (const edge of graph.edges) {
    if (edge.primary) primaryBySource.set(edge.from, edge);
  }

  const streams: RelayStream[] = [];
  for (const edge of graph.edges) {
    // A funnel is rooted at a node whose own path home is a relay — the same
    // primary-relay edges the map counts — so the list and the map agree on
    // how many streams there are.
    if (edge.primary && edge.style === "relay") {
      streams.push(walkStream(edge.from, primaryBySource, nameById, kindById));
    }
  }

  // Stable order so the list is reproducible run to run.
  streams.sort(
    (a, b) => a.leafName.localeCompare(b.leafName) || a.id.localeCompare(b.id),
  );
  return streams;
}
