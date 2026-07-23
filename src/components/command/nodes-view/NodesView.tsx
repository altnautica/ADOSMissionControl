"use client";

/**
 * @module command/nodes-view/NodesView
 * @description The fleet-operations board — the Dashboard's third view mode.
 *
 * The card grid answers "how is each node doing?" one node at a time. This
 * board answers the fleet-wide question instead: one dense live row per node,
 * ordered live → stale → offline, with the controls that change a node's state
 * in the row itself rather than three clicks into its detail panel, and a
 * selection that applies one change across many.
 *
 * Rows are the membership list joined to the same per-node telemetry projection
 * the grid consumes, so liveness, radio and battery are derived once and read
 * identically on both surfaces.
 *
 * @license GPL-3.0-only
 */

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandAgentFleet } from "@/hooks/use-command-agent-fleet";
import { useSkillToastBridge } from "@/hooks/use-skill-toast-bridge";
import { joinNodeRows, nodeMatchesQuery } from "@/lib/nodes/node-rows";
import { buildNodeTree } from "@/lib/nodes/node-tree";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import { NodeBoardRow } from "./NodeBoardRow";
import { useNodeCommandLane } from "./use-node-command-lane";
import { CloudCommandAckWatcher } from "./CloudCommandAckWatcher";
import { BulkActionBar } from "./BulkActionBar";
import {
  NodesHeader,
  REACH_FILTERS,
  matchesReachFilter,
  type ReachFilter,
} from "./NodesHeader";
import { dispatchSkillForNodes } from "./use-node-skills";
import { FleetActionConfirm } from "./FleetActionConfirm";
import { MeshReachPanel } from "./MeshReachPanel";

/** The board renders no feeds, so both video budgets are permanently empty. */
const NO_VIDEO_IDS: Set<string> = new Set();

const HEAD_CELL =
  "px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-tertiary";

/** Column order, as translation keys. Each maps to one cell in the row. */
const COLUMNS = [
  "columnNode",
  "columnReach",
  "columnLink",
  "columnBattery",
  "columnMode",
  "columnRelay",
  "columnFeatures",
  "columnLastSeen",
  "columnActions",
] as const;

export interface NodesViewProps {
  fleetNodes: FleetNodeEntry[];
  /** Opens a node's detail panel. Takes the agent device id, as the grid does. */
  onOpenAgent: (deviceId: string) => void;
  /** Opens the shared add-a-node dialog. */
  onOpenPairing: () => void;
}

export function NodesView({
  fleetNodes,
  onOpenAgent,
  onOpenPairing,
}: NodesViewProps) {
  const t = useTranslations("nodesView");
  const laneOptions = useNodeCommandLane();
  // A rejected control has to say why. The dispatcher answers with raw keys, so
  // without this bridge every refusal on this board would be silent. The same
  // bridge carries the cloud watcher's later accepted/rejected verdicts.
  useSkillToastBridge();

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ReachFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmingReturnAll, setConfirmingReturnAll] = useState(false);

  // The same projection the grid consumes. It carries its own 1 Hz tick, so
  // liveness and the age labels below re-derive every second.
  const summaries = useCommandAgentFleet(fleetNodes, NO_VIDEO_IDS, NO_VIDEO_IDS);
  const rows = useMemo(
    () => joinNodeRows(fleetNodes, summaries),
    [fleetNodes, summaries],
  );

  // Reach drives both the filter chips and their counts, so a chip's number is
  // the number of rows it will actually show.
  const reachKinds = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.node._id,
          describeNodeReach(row.node, laneOptions).kind,
        ]),
      ),
    [rows, laneOptions],
  );

  const searched = useMemo(
    () => rows.filter((row) => nodeMatchesQuery(row.node, query)),
    [rows, query],
  );

  const counts = useMemo(() => {
    const out = Object.fromEntries(
      REACH_FILTERS.map((id) => [id, 0]),
    ) as Record<ReachFilter, number>;
    for (const row of searched) {
      out.all += 1;
      const kind = reachKinds.get(row.node._id);
      if (kind) out[kind] += 1;
    }
    return out;
  }, [searched, reachKinds]);

  const visible = useMemo(
    () =>
      searched.filter((row) => {
        const kind = reachKinds.get(row.node._id);
        return kind ? matchesReachFilter(filter, kind) : filter === "all";
      }),
    [searched, filter, reachKinds],
  );

  // Selection survives filtering, but only the rows on screen can be acted on —
  // a bulk command must never reach a node the operator cannot currently see.
  const selectedRows = useMemo(
    () => visible.filter((row) => selected.has(row.node._id)),
    [visible, selected],
  );

  const allVisibleSelected =
    visible.length > 0 && selectedRows.length === visible.length;

  // Nest the visible rows into the reach hierarchy: a drone reached only through
  // a ground node's WFB relay renders indented under that ground node. A pure
  // projection over reach-path — same rows, re-sequenced with a depth.
  const tree = useMemo(() => buildNodeTree(visible), [visible]);

  function toggleRow(nodeId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) next.delete(nodeId);
      else next.add(nodeId);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const row of visible) next.delete(row.node._id);
        return next;
      }
      const next = new Set(prev);
      for (const row of visible) next.add(row.node._id);
      return next;
    });
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      {/* Watches every in-flight cloud command for the vehicle's real answer and
          raises it through the toast bridge above. Renders nothing itself. */}
      <CloudCommandAckWatcher nodes={fleetNodes} />
      <div className="mb-3">
        <h1 className="text-lg font-semibold text-text-primary">{t("title")}</h1>
        <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
      </div>

      <NodesHeader
        query={query}
        onQueryChange={setQuery}
        filter={filter}
        onFilterChange={setFilter}
        counts={counts}
        onReturnAll={() => setConfirmingReturnAll(true)}
        onAddNode={onOpenPairing}
      />

      <BulkActionBar
        selectedRows={selectedRows}
        laneOptions={laneOptions}
        onClear={() => setSelected(new Set())}
      />

      {visible.length === 0 ? (
        <p className="mt-10 text-center text-sm text-text-tertiary">
          {t("noMatches")}
        </p>
      ) : (
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
          <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border-default bg-bg-secondary">
            <table className="w-full min-w-[1040px] border-collapse text-xs">
              <caption className="sr-only">{t("tableCaption")}</caption>
              <thead>
                <tr className="border-b border-border-default">
                  <th scope="col" className={HEAD_CELL}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      disabled={visible.length === 0}
                      aria-label={t("selectAll")}
                      className="accent-[var(--alt-accent-primary)]"
                    />
                  </th>
                  {COLUMNS.map((column) => (
                    <th key={column} scope="col" className={HEAD_CELL}>
                      {t(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tree.map(({ row, depth }) => (
                  <NodeBoardRow
                    key={row.node._id}
                    row={row}
                    depth={depth}
                    laneOptions={laneOptions}
                    selected={selected.has(row.node._id)}
                    onToggleSelected={() => toggleRow(row.node._id)}
                    onOpen={(node) => onOpenAgent(node.deviceId)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <MeshReachPanel rows={visible} laneOptions={laneOptions} />
        </div>
      )}

      {confirmingReturnAll && (
        <FleetActionConfirm
          rows={rows}
          laneOptions={laneOptions}
          onDone={() => setConfirmingReturnAll(false)}
          onRun={(targets) =>
            void dispatchSkillForNodes(
              "rth",
              targets.map((row) => row.node),
              laneOptions,
            )
          }
        />
      )}
    </div>
  );
}
