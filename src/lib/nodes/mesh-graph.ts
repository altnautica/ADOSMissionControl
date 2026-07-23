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
   * the hop and otherwise points the relay edge at the sink.
   */
  reachedViaId: string | null;
  primary: NodeBearerChip;
  /** An alternate path the node is also carried over (multi-path), or null. */
  secondary: NodeBearerChip | null;
}

/** A vertex: a fleet node, or the GCS sink. */
export interface MeshVertex {
  id: string;
  kind: "gcs" | "node";
  name: string;
  /** The node's profile, or null for the GCS sink. */
  profile: NodeProfile | null;
  /** The node's liveness, or null for the GCS sink. */
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

/** Resolve one bearer chip into its edge, pointing a relay hop at the ground
 * node when that node is in view, otherwise at the sink. */
function edgeFor(
  input: MeshNodeInput,
  chip: NodeBearerChip,
  primary: boolean,
  presentIds: ReadonlySet<string>,
): MeshEdge {
  const relay = chip.kind === "wfb";
  const parentPresent =
    input.reachedViaId != null &&
    input.reachedViaId !== input.id &&
    presentIds.has(input.reachedViaId);
  return {
    id: `${input.id}:${primary ? "primary" : "secondary"}`,
    from: input.id,
    to: relay && parentPresent ? input.reachedViaId! : MESH_GCS_ID,
    bearer: chip.kind,
    verification: chip.verification,
    style: relay ? "relay" : "data",
    primary,
  };
}

/**
 * Build the fleet's reach graph from the per-node reach inputs. Pure: the same
 * inputs always produce the same vertices and edges, and the verification each
 * edge carries is exactly the verification the row resolved — never upgraded.
 */
export function buildMeshGraph(inputs: readonly MeshNodeInput[]): MeshGraph {
  const presentIds = new Set(inputs.map((i) => i.id));
  const vertices: MeshVertex[] = [
    { id: MESH_GCS_ID, kind: "gcs", name: "GCS", profile: null, liveness: null },
    ...inputs.map((i) => ({
      id: i.id,
      kind: "node" as const,
      name: i.name,
      profile: i.profile,
      liveness: i.liveness,
    })),
  ];

  const edges: MeshEdge[] = [];
  for (const input of inputs) {
    edges.push(edgeFor(input, input.primary, true, presentIds));
    // A directly-reached node that a ground node also relays draws the WFB path
    // as a second, alternate edge — the multi-path redundancy the map exists to
    // show. Its verification is whatever the row proved, never more.
    if (input.secondary) {
      edges.push(edgeFor(input, input.secondary, false, presentIds));
    }
  }

  return { vertices, edges };
}
