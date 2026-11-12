"use client";

import { useState, useMemo, useCallback } from "react";
import { useTranslations } from "next-intl";
import { useDroneManager } from "@/stores/drone-manager";
import { useConnectDialogStore } from "@/stores/connect-dialog-store";
import { Plus, Search, ChevronLeft, ChevronRight, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFleetNodes, type FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useClockTick } from "@/lib/agent/freshness";
import { useForgetNode } from "@/hooks/use-forget-node";
import { NodeRow } from "@/components/command/nodes/NodeRow";
import { NodeRail } from "@/components/command/nodes/NodeRail";
import { NodeContextMenu } from "@/components/command/nodes/NodeContextMenu";
import { ReconnectingDrones } from "./ReconnectingDrones";

/** Non-flight nodes sink below the drones (Visor, compute, then ground); a
 * profile this build does not know sinks to the bottom. */
const PROFILE_RANK: Record<FleetNodeEntry["profile"], number> = {
  drone: 0,
  visor: 1,
  workstation: 2,
  compute: 2,
  "ground-station": 3,
  unknown: 4,
};

interface DroneListPanelProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * The dashboard fleet sidebar. Renders every node — drone / FC-only / compute /
 * ground — through the one profile-aware `NodeRow` (a 52 px row: the node tile
 * with its liveness dot, the name, and a one-line meta summary), reconciled onto
 * the dashboard's `useDroneManager` selection (`node:<deviceId>`). Compute and
 * ground nodes sort to the bottom.
 */
export function DroneListPanel({ collapsed, onToggleCollapse }: DroneListPanelProps) {
  const tq = useTranslations("dashboard.droneListPanel");
  const t = useTranslations("fleet");
  const nodes = useFleetNodes();
  const selectedDroneId = useDroneManager((s) => s.selectedDroneId);
  const selectDrone = useDroneManager((s) => s.selectDrone);
  const openDialog = useConnectDialogStore((s) => s.openDialog);
  const forget = useForgetNode();
  // 1 Hz tick so freshness (live / stale / offline) transitions without needing
  // an unrelated store update to trigger a re-render.
  useClockTick();

  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    nodeId: string;
    x: number;
    y: number;
  } | null>(null);

  const ordered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? nodes.filter(
          (n) =>
            n.name.toLowerCase().includes(q) ||
            n.deviceId.toLowerCase().includes(q),
        )
      : nodes;
    // Stable profile-rank sort: drones first, then compute, then ground.
    return filtered
      .map((n, i) => ({ n, i }))
      .sort(
        (a, b) =>
          PROFILE_RANK[a.n.profile] - PROFILE_RANK[b.n.profile] || a.i - b.i,
      )
      .map(({ n }) => n);
  }, [nodes, search]);

  // Stable callbacks so the memoised rows only re-render for their own entry.
  const openContext = useCallback((nodeId: string, x: number, y: number) => {
    setContextMenu({ nodeId, x, y });
  }, []);
  const selectNode = useCallback((n: FleetNodeEntry) => selectDrone(n._id), [selectDrone]);

  const activeContextNode = contextMenu
    ? nodes.find((n) => n._id === contextMenu.nodeId) ?? null
    : null;
  const contextEl =
    contextMenu && activeContextNode ? (
      <NodeContextMenu
        node={activeContextNode}
        x={contextMenu.x}
        y={contextMenu.y}
        onClose={() => setContextMenu(null)}
        onOpen={(n) => {
          setContextMenu(null);
          selectDrone(n._id);
        }}
        onForget={(n) => {
          setContextMenu(null);
          void forget(n._id, { convexId: n.convexId ?? null });
        }}
      />
    ) : null;

  function renderRow(node: FleetNodeEntry) {
    return (
      <NodeRow
        node={node}
        selected={node._id === selectedDroneId}
        onSelect={selectNode}
        onContext={openContext}
      />
    );
  }

  if (collapsed) {
    return (
      <div className="w-12 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
        {/* Header: label + add + expand */}
        <div className="flex flex-col items-center gap-1.5 px-1 py-2 border-b border-border-default">
          <span className="text-[9px] font-semibold uppercase tracking-wider text-text-tertiary">
            {t("title")}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openDialog();
            }}
            className="w-full aspect-square flex items-center justify-center bg-accent-primary/10 hover:bg-accent-primary transition-colors cursor-pointer group"
            title={t("addDrone")}
          >
            <Plus size={12} className="text-accent-primary group-hover:text-bg-primary transition-colors" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="w-full aspect-square flex items-center justify-center hover:bg-bg-tertiary transition-colors cursor-pointer group"
            title={t("expandPanel")}
          >
            <ChevronRight size={12} className="text-text-tertiary group-hover:text-text-secondary transition-colors" />
          </button>
        </div>

        {/* Node rail */}
        <div
          role="listbox"
          aria-label={tq("nodes")}
          className="flex-1 overflow-auto flex flex-col items-center gap-1 py-1.5"
        >
          {ordered.map((node) => (
            <NodeRail
              key={node._id}
              node={node}
              selected={node._id === selectedDroneId}
              title={node.name}
              onSelect={(n) => selectDrone(n._id)}
              onContext={openContext}
            />
          ))}
        </div>

        {/* Count */}
        <div className="text-center py-1 border-t border-border-default">
          <span className="text-[9px] text-text-tertiary font-mono">{nodes.length}</span>
        </div>
        {contextEl}
      </div>
    );
  }

  return (
    <div className="w-72 shrink-0 flex flex-col h-full border-r border-border-default bg-bg-secondary">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-secondary">
          {t("title")}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={openDialog}
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-text-tertiary hover:text-text-primary transition-colors"
            title={t("addDrone")}
            aria-label={t("addDrone")}
          >
            <Plus size={14} />
          </button>
          <button
            onClick={onToggleCollapse}
            className="flex h-9 w-9 items-center justify-center rounded-[4px] text-text-tertiary hover:text-text-primary transition-colors"
            title={t("collapsePanel")}
            aria-label={t("collapsePanel")}
          >
            <ChevronLeft size={14} />
          </button>
        </div>
      </div>

      {/* Fleet overview CTA — jump back to the Agent Overview grid. */}
      <div className="px-3 pt-2">
        <button
          onClick={() => selectDrone(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-medium transition-colors",
            selectedDroneId === null
              ? "border-accent-primary/40 bg-accent-primary/10 text-accent-primary"
              : "border-border-default text-text-secondary hover:bg-bg-tertiary hover:text-text-primary",
          )}
        >
          <LayoutGrid size={14} className="shrink-0" />
          {t("overview")}
        </button>
      </div>

      {/* Drones being re-dialled after a link loss, each with a stop action. */}
      <ReconnectingDrones />

      {/* Search */}
      <div className="px-3 py-2 border-b border-border-default">
        <div className="flex h-8 items-center gap-2 rounded-[4px] border border-border-default bg-bg-primary px-2.5 focus-within:border-accent-primary">
          <Search size={12} className="text-text-tertiary shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("searchDrones")}
            aria-label={t("searchDrones")}
            className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-tertiary outline-none"
          />
        </div>
      </div>

      {/* Node list */}
      <div role="listbox" aria-label={tq("nodes")} className="flex-1 overflow-auto p-1.5 space-y-0.5">
        {ordered.map((node) => (
          <div key={node._id}>{renderRow(node)}</div>
        ))}
        {ordered.length === 0 && (
          <div className="text-xs text-text-tertiary text-center py-4">
            {search ? t("noMatch") : t("noDrones")}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-border-default">
        <span className="text-[10px] text-text-tertiary">
          {t("droneCount", { count: nodes.length })}
        </span>
      </div>

      {contextEl}
    </div>
  );
}
