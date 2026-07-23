"use client";

/**
 * @module command/nodes-view/MeshReachMap
 * @description The live node-to-node reach graph — the fleet's connection fabric
 * drawn as vertices and edges converging on the GCS at the centre.
 *
 * A solid edge is a data path (LAN / cloud / a directly-connected board); a
 * dashed edge is a mesh / relay stream. Colour names the bearer. A relay stream
 * animates a flow toward the sink ONLY when it is a proven, live link — a
 * received-side frame was heard — and never when the operator prefers reduced
 * motion. An unverified, stale, or down link is drawn dashed and dimmed, never
 * as a confident, solid, flowing path (Rule 44 / Rule 37), so the redundancy the
 * map shows is redundancy the rows can actually prove.
 *
 * The graph is supplementary: every fact it draws is also in the table beside
 * it, and the relay-streams list below is its text equivalent. The SVG carries a
 * one-line summary for assistive tech rather than being the only way in.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type {
  BearerVerification,
  NodeBearerKind,
} from "@/lib/nodes/node-bearer";
import {
  MESH_GCS_ID,
  type MeshEdge,
  type MeshGraph,
  type MeshVertex,
} from "@/lib/nodes/mesh-graph";
import { layoutMeshGraph, type Point } from "@/lib/nodes/mesh-layout";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { cn } from "@/lib/utils";

const SIZE = 320;

/** One colour per bearer — the legend the operator reads the graph by. */
const BEARER_STROKE: Record<NodeBearerKind, string> = {
  lan: "var(--color-status-success)",
  wfb: "var(--color-status-warning)",
  cloud: "var(--color-accent-primary)",
  "direct-fc": "var(--node-accent-fc)",
  none: "var(--color-text-tertiary)",
};

/** How much a bearer's own colour survives its verification. A down / no-signal
 * edge is greyed outright; the rest keep their colour and lose opacity. */
const EDGE_OPACITY: Record<BearerVerification, number> = {
  verified: 0.95,
  unverified: 0.55,
  stale: 0.4,
  down: 0.3,
};

function edgeStroke(edge: MeshEdge): string {
  if (edge.verification === "down" || edge.bearer === "none") {
    return "var(--color-text-tertiary)";
  }
  return BEARER_STROKE[edge.bearer];
}

/** A vertex ring reads the node's liveness, so a dark node never rings green. */
function vertexRing(vertex: MeshVertex): string {
  if (vertex.kind === "gcs") return "var(--color-accent-secondary)";
  if (vertex.liveness === "live") return "var(--color-status-success)";
  if (vertex.liveness === "stale") return "var(--color-status-warning)";
  return "var(--color-text-tertiary)";
}

export function MeshReachMap({ graph }: { graph: MeshGraph }) {
  const t = useTranslations("nodesView.meshMap");
  const reducedMotion = usePrefersReducedMotion();
  const positions = useMemo(() => layoutMeshGraph(graph, SIZE), [graph]);

  // The bearers actually present, in a stable order — the legend advertises only
  // what the graph draws, never a bearer with no edge (Rule 44).
  const bearers = useMemo(() => {
    const seen = new Set<NodeBearerKind>();
    for (const edge of graph.edges) seen.add(edge.bearer);
    return (Object.keys(BEARER_STROKE) as NodeBearerKind[]).filter((b) =>
      seen.has(b),
    );
  }, [graph.edges]);

  // Off-view relay parents are terminals, not fleet nodes, so the summary count
  // stays honest (Rule 44).
  const nodeCount = graph.vertices.filter((v) => v.kind === "node").length;
  const relayCount = graph.edges.filter(
    (e) => e.style === "relay" && e.primary,
  ).length;
  const summary = t("summary", {
    nodes: nodeCount,
    paths: graph.edges.length,
    relays: relayCount,
  });

  if (nodeCount === 0) {
    return <p className="p-4 text-center text-xs text-text-tertiary">{t("empty")}</p>;
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label={summary}
        className="mx-auto block h-auto w-full max-w-[320px]"
      >
        <g>
          {graph.edges.map((edge) => (
            <EdgeLine
              key={edge.id}
              edge={edge}
              from={positions.get(edge.from)}
              to={positions.get(edge.to)}
              reducedMotion={reducedMotion}
            />
          ))}
        </g>
        <g>
          {graph.vertices.map((vertex) => (
            <VertexDot
              key={vertex.id}
              vertex={vertex}
              at={positions.get(vertex.id)}
            />
          ))}
        </g>
      </svg>

      {bearers.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-1" aria-label={t("legend")}>
          {bearers.map((bearer) => (
            <li key={bearer} className="flex items-center gap-1 text-[10px] text-text-tertiary">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-3 rounded"
                style={{ backgroundColor: BEARER_STROKE[bearer] }}
              />
              {t(`bearer.${bearer}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EdgeLine({
  edge,
  from,
  to,
  reducedMotion,
}: {
  edge: MeshEdge;
  from: Point | undefined;
  to: Point | undefined;
  reducedMotion: boolean;
}) {
  if (!from || !to) return null;
  const dashed = edge.style === "relay" || edge.verification !== "verified";
  // A relay stream flows only when it is a proven, live link — and never under a
  // reduced-motion preference.
  const flowing =
    edge.style === "relay" && edge.verification === "verified" && !reducedMotion;
  return (
    <line
      data-testid="mesh-edge"
      data-edge={edge.id}
      data-bearer={edge.bearer}
      data-verification={edge.verification}
      data-style={edge.style}
      data-flowing={flowing || undefined}
      x1={from.x}
      y1={from.y}
      x2={to.x}
      y2={to.y}
      stroke={edgeStroke(edge)}
      strokeWidth={edge.primary ? 1.75 : 1}
      strokeOpacity={EDGE_OPACITY[edge.verification]}
      strokeDasharray={dashed ? "5 4" : undefined}
      className={cn(flowing && "mesh-flow")}
    />
  );
}

function VertexDot({
  vertex,
  at,
}: {
  vertex: MeshVertex;
  at: Point | undefined;
}) {
  const t = useTranslations("nodesView.meshMap");
  if (!at) return null;
  const isGcs = vertex.kind === "gcs";
  const isOffView = vertex.kind === "offview";
  const r = isGcs ? 9 : isOffView ? 5 : 6;
  // An off-view parent is drawn dashed and dim: it names where a relay reaches
  // without pretending to be a present, live fleet node (Rule 44).
  const offViewLabel = vertex.name
    ? t("offViewNode", { name: vertex.name })
    : t("offViewRelay");
  const label = isGcs ? "GCS" : isOffView ? offViewLabel : vertex.name;
  const anchor = at.x > SIZE / 2 ? "start" : "end";
  const labelX = at.x + (anchor === "start" ? r + 3 : -(r + 3));
  return (
    <g>
      <circle
        cx={at.x}
        cy={at.y}
        r={r}
        fill="var(--color-bg-secondary)"
        stroke={vertexRing(vertex)}
        strokeWidth={isGcs ? 2 : 1.5}
        strokeOpacity={isOffView ? 0.55 : 1}
        strokeDasharray={isOffView ? "2 2" : undefined}
      />
      <title>{label}</title>
      <text
        x={labelX}
        y={at.y + 3}
        textAnchor={anchor}
        fontSize={9}
        fill={isGcs ? "var(--color-text-secondary)" : "var(--color-text-tertiary)"}
        fontFamily="var(--font-mono)"
        opacity={isOffView ? 0.7 : 1}
      >
        {label.length > 12 ? `${label.slice(0, 11)}…` : label}
      </text>
    </g>
  );
}
