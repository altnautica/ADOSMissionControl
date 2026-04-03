/**
 * @module layout
 * @description Dagre-based auto-layout utility for the architecture diagram.
 * @license GPL-3.0-only
 */

import dagre from "dagre";
import type { Node, Edge } from "@xyflow/react";

const NODE_WIDTH = 220;
const NODE_HEIGHT = 120;
const SBC_WIDTH = 280;
const SBC_HEIGHT = 200;

export function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction: "TB" | "LR" = "TB"
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: direction, ranksep: 80, nodesep: 40 });

  for (const node of nodes) {
    const isSbc = node.type === "sbc";
    g.setNode(node.id, {
      width: isSbc ? SBC_WIDTH : NODE_WIDTH,
      height: isSbc ? SBC_HEIGHT : NODE_HEIGHT,
    });
  }

  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const isSbc = node.type === "sbc";
    const w = isSbc ? SBC_WIDTH : NODE_WIDTH;
    const h = isSbc ? SBC_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutedNodes, edges };
}
