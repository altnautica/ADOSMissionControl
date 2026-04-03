"use client";

/**
 * @module ArchitectureDiagram
 * @description React Flow canvas that visualizes the drone's hardware architecture
 * as a node-graph diagram with dagre auto-layout.
 * @license GPL-3.0-only
 */

import { useMemo, useCallback } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import type { PeripheralInfo } from "@/lib/agent/types";
import type { AgentStatus, SystemResources } from "@/lib/agent/types";
import { nodeTypes } from "./nodes";
import { getLayoutedElements } from "./layout";

interface ArchitectureDiagramProps {
  peripherals: PeripheralInfo[];
  status: AgentStatus | null;
  resources: SystemResources | null;
}

function buildBusLabel(bus: string): string {
  const lower = bus.toLowerCase();
  if (lower.includes("usb")) return "USB";
  if (lower.includes("csi") || lower.includes("mipi")) return "CSI";
  if (lower.includes("i2c")) return "I2C";
  if (lower.includes("spi")) return "SPI";
  if (lower.includes("uart") || lower.includes("serial")) return "UART";
  if (lower.includes("pcie")) return "PCIe";
  return bus;
}

function buildGraph(
  peripherals: PeripheralInfo[],
  status: AgentStatus | null,
  resources: SystemResources | null
): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // SBC central node
  nodes.push({
    id: "sbc",
    type: "sbc",
    position: { x: 0, y: 0 },
    data: {
      boardName: status?.board?.name ?? "SBC",
      soc: status?.board?.soc ?? "Unknown",
      arch: status?.board?.arch ?? "Unknown",
      tier: status?.board?.tier ?? 0,
      version: status?.version ?? "0.0.0",
      uptimeSeconds: status?.uptime_seconds ?? 0,
      fcConnected: status?.fc_connected ?? false,
      cpuPercent: resources?.cpu_percent ?? null,
      memoryPercent: resources?.memory_percent ?? null,
      diskPercent: resources?.disk_percent ?? null,
      temperature: resources?.temperature ?? null,
    },
    draggable: true,
    connectable: false,
    selectable: true,
  });

  // Create device nodes from peripherals
  for (let i = 0; i < peripherals.length; i++) {
    const p = peripherals[i];
    const nodeId = `device-${i}`;

    nodes.push({
      id: nodeId,
      type: "device",
      position: { x: 0, y: 0 },
      data: {
        name: p.name,
        category: p.category,
        type: p.type,
        bus: p.bus,
        address: p.address,
        status: p.status,
        lastReading: p.last_reading,
        rateHz: p.rate_hz,
        endpointCount: (p as unknown as Record<string, unknown>).endpoint_count ?? undefined,
      },
      draggable: true,
      connectable: false,
      selectable: true,
    });

    edges.push({
      id: `edge-sbc-${nodeId}`,
      source: "sbc",
      target: nodeId,
      label: buildBusLabel(p.bus),
      style: { stroke: "#3A82FF", strokeWidth: 1.5 },
      labelStyle: { fill: "#9CA3AF", fontSize: 10, fontFamily: "monospace" },
      labelBgStyle: { fill: "#0A0A0F", fillOpacity: 0.85 },
      labelBgPadding: [4, 2] as [number, number],
      animated: p.status === "ok",
    });
  }

  return getLayoutedElements(nodes, edges);
}

export function ArchitectureDiagram({
  peripherals,
  status,
  resources,
}: ArchitectureDiagramProps) {
  const { initialNodes, initialEdges } = useMemo(() => {
    const { nodes, edges } = buildGraph(peripherals, status, resources);
    return { initialNodes: nodes, initialEdges: edges };
  }, [peripherals, status, resources]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Re-layout when data changes
  useMemo(() => {
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges, setNodes, setEdges]);

  const onInit = useCallback((instance: { fitView: () => void }) => {
    instance.fitView();
  }, []);

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={onInit}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.3}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="#1a1a2e"
        />
        <Controls
          showInteractive={false}
          className="!bg-bg-secondary !border-border-default !shadow-lg [&>button]:!bg-bg-secondary [&>button]:!border-border-default [&>button]:!text-text-secondary [&>button:hover]:!bg-bg-tertiary"
        />
        <MiniMap
          nodeColor={(node) => (node.type === "sbc" ? "#3A82FF" : "#374151")}
          maskColor="rgba(10, 10, 15, 0.8)"
          className="!bg-bg-secondary !border-border-default"
        />
      </ReactFlow>
    </div>
  );
}
