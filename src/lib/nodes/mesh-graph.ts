/**
 * The fleet's connection fabric as a node-to-node graph.
 *
 * The board's table answers "how is each node doing?" one row at a time. The
 * mesh graph answers a different question: how is the fleet actually wired
 * together — which node reaches the GCS directly, which is carried over another
 * node's radio relay, and where the redundancy is. It is a pure projection over
 * the same per-node reach + bearer state the Reach column already renders, so
 * the graph and the table can never disagree about a node's link.
 *
 * The GCS is a vertex too — the sink every reach path converges on. A directly
 * reached node draws a solid data-path edge to it (LAN / cloud / direct-fc); a
 * relayed drone draws a dashed relay-stream edge to the ground node that carries
 * it, and that ground node draws its own edge home. So a two-hop funnel
 * (drone → ground node → GCS) is two edges, and the interlinking reads as the
 * mesh it is rather than a flat list.
 *
 * Verification travels with every edge, and the presentation must honour it
 * (Rule 44 / Rule 37): a relay stream is only ever a proven, flowing link when
 * the far side heard a frame from it; otherwise the edge is unverified / stale /
 * down and must never render as a confident, solid, flowing path.
 *
 * @module nodes/mesh-graph
 * @license GPL-3.0-only
 */

import type {
  BearerVerification,
  NodeBearerChip,
  NodeBearerKind,
} from "@/lib/nodes/node-bearer";
import type { NodeProfile } from "@/stores/node-registry";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";

/** The single well-known id of the sink every reach path converges on. */
export const MESH_GCS_ID = "gcs";

/**
 * One node's resolved reach, as the graph consumes it. The board resolves the
 * bearers and the reach-hop once per row (the same derivation the Reach column
 * uses) and hands them here, so this module stays pure and testable without a
 * store or a React tree.
 */
export interface MeshNodeInput {
  /** The node's canonical `node:<deviceId>` id. */
  id: string;
  name: string;
  profile: NodeProfile;
  liveness: CommandAgentLiveness;
  /** True when the node is reached ONLY through a WFB relay (no direct link). */
  isRelayed: boolean;
  /**
   * The `node:<deviceId>` id of the ground node this node's WFB path runs
   * through, when it has one. It may name a node not in the current input set
   * (filtered out, or off screen); the graph checks membership before drawing
   * the hop and otherwise terminates the relay at a named off-view parent —
   * never at the GCS sink, which would assert a WFB link that does not exist.
   */
  reachedViaId: string | null;
  /** The resolved display name of that ground node, when known — so an off-view
   * relay parent can be named rather than left as a raw id (null when unknown). */
  reachedViaName: string | null;
  primary: NodeBearerChip;
  /** An alternate path the node is also carried over (multi-path), or null. */
  secondary: NodeBearerChip | null;
}

/**
 * A vertex kind: a fleet node, the GCS sink, or an off-view relay parent — a
 * ground node that carries a relayed drone but is outside the current view
 * (filtered out / off screen). The off-view parent exists only to terminate the
 * relay funnel honestly, so the WFB bearer is never redirected to the GCS.
 */
export type MeshVertexKind = "gcs" | "node" | "offview";

/** A vertex: a fleet node, the GCS sink, or an off-view relay parent. */
export interface MeshVertex {
  id: string;
  kind: MeshVertexKind;
  name: string;
  /** The node's profile, or null for the GCS sink / an off-view parent. */
  profile: NodeProfile | null;
  /** The node's liveness, or null for the GCS sink / an off-view parent. */
  liveness: CommandAgentLiveness | null;
}

/** A solid data path vs a dashed mesh / relay stream. */
export type MeshEdgeStyle = "data" | "relay";

/** A reach path from one node toward its sink (a parent node, or the GCS). */
export interface MeshEdge {
  id: string;
  /** The source node id (the leaf / child end the flow starts from). */
  from: string;
  /** The sink: a parent node id, or {@link MESH_GCS_ID}. */
  to: string;
  bearer: NodeBearerKind;
  verification: BearerVerification;
  style: MeshEdgeStyle;
  /** False for an alternate / secondary path a node is also carried over. */
  primary: boolean;
}

export interface MeshGraph {
  vertices: MeshVertex[];
  edges: MeshEdge[];
}

/**
 * The vertex a relay hop terminates at. The ground node when it is a drawn
 * vertex; otherwise a synthetic off-view parent that terminates the funnel
 * where the relay actually reaches — never the GCS sink, which would render the
 * WFB bearer as a peer link to the GCS that does not exist (Rule 44). A known
 * off-view parent keeps its own id so several drones relayed through it funnel
 * to the one terminal; an unknown parent gets a per-node id so two unknown
 * relays are never merged into one false shared parent.
 */
function relayTerminal(
  input: MeshNodeInput,
  presentIds: ReadonlySet<string>,
): { toId: string; offView: MeshVertex | null } {
  const parentId = input.reachedViaId;
  if (parentId != null && parentId !== input.id && presentIds.has(parentId)) {
    return { toId: parentId, offView: null };
  }
  const known = parentId != null && parentId !== input.id;
  const toId = known ? parentId : `offview:${input.id}`;
  return {
    toId,
    offView: {
      id: toId,
      kind: "offview",
      name: known ? (input.reachedViaName ?? "") : "",
      profile: null,
      liveness: null,
    },
  };
}

/** Resolve one bearer chip into its edge. A data path points at the GCS sink; a
 * relay hop points at its ground node in view, or an off-view parent terminal
 * when that node is filtered out — the relay is never redirected to the sink. */
function edgeFor(
  input: MeshNodeInput,
  chip: NodeBearerChip,
  primary: boolean,
  presentIds: ReadonlySet<string>,
): { edge: MeshEdge; offView: MeshVertex | null } {
  const relay = chip.kind === "wfb";
  const { toId, offView } = relay
    ? relayTerminal(input, presentIds)
    : { toId: MESH_GCS_ID, offView: null };
  return {
    edge: {
      id: `${input.id}:${primary ? "primary" : "secondary"}`,
      from: input.id,
      to: toId,
      bearer: chip.kind,
      verification: chip.verification,
      style: relay ? "relay" : "data",
      primary,
    },
    offView,
  };
}

/**
 * Build the fleet's reach graph from the per-node reach inputs. Pure: the same
 * inputs always produce the same vertices and edges, and the verification each
 * edge carries is exactly the verification the row resolved — never upgraded.
 */
export function buildMeshGraph(inputs: readonly MeshNodeInput[]): MeshGraph {
  const presentIds = new Set(inputs.map((i) => i.id));
  const edges: MeshEdge[] = [];
  // Off-view relay parents, deduped by id: several drones relayed through the
  // one off-view ground node share a single terminal vertex.
  const offViewById = new Map<string, MeshVertex>();

  const push = (resolved: { edge: MeshEdge; offView: MeshVertex | null }) => {
    edges.push(resolved.edge);
    if (resolved.offView && !offViewById.has(resolved.offView.id)) {
      offViewById.set(resolved.offView.id, resolved.offView);
    }
  };

  for (const input of inputs) {
    push(edgeFor(input, input.primary, true, presentIds));
    // A directly-reached node that a ground node also relays draws the WFB path
    // as a second, alternate edge — the multi-path redundancy the map exists to
    // show. Its verification is whatever the row proved, never more.
    if (input.secondary) {
      push(edgeFor(input, input.secondary, false, presentIds));
    }
  }

  const vertices: MeshVertex[] = [
    { id: MESH_GCS_ID, kind: "gcs", name: "GCS", profile: null, liveness: null },
    ...inputs.map((i) => ({
      id: i.id,
      kind: "node" as const,
      name: i.name,
      profile: i.profile,
      liveness: i.liveness,
    })),
    ...offViewById.values(),
  ];

  return { vertices, edges };
}
