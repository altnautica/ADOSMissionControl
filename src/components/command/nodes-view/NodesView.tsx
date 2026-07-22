"use client";

/**
 * @module command/nodes-view/NodesView
 * @description The fleet-operations board — the Dashboard's third view mode.
 *
 * The card grid answers "how is each node doing?" one node at a time. This
 * board answers the fleet-wide question instead: one dense live row per node,
 * ordered live → stale → offline, with the controls that change a node's state
 * in the row itself rather than three clicks into its detail panel.
 *
 * Rows are the membership list joined to the same per-node telemetry projection
 * the grid consumes, so liveness, radio and battery are derived once and read
 * identically on both surfaces.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandAgentFleet } from "@/hooks/use-command-agent-fleet";
import { joinNodeRows } from "@/lib/nodes/node-rows";
import { NodeBoardRow } from "./NodeBoardRow";
import { useNodeCommandLane } from "./use-node-command-lane";

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
] as const;

export interface NodesViewProps {
  fleetNodes: FleetNodeEntry[];
  /** Opens a node's detail panel. Takes the agent device id, as the grid does. */
  onOpenAgent: (deviceId: string) => void;
}

export function NodesView({ fleetNodes, onOpenAgent }: NodesViewProps) {
  const t = useTranslations("nodesView");
  const laneOptions = useNodeCommandLane();

  // The same projection the grid consumes. It carries its own 1 Hz tick, so
  // liveness and the age labels below re-derive every second.
  const summaries = useCommandAgentFleet(fleetNodes, NO_VIDEO_IDS, NO_VIDEO_IDS);
  const rows = useMemo(
    () => joinNodeRows(fleetNodes, summaries),
    [fleetNodes, summaries],
  );

  return (
    <div className="flex-1 overflow-y-auto p-3 md:p-4">
      <div className="mb-3">
        <h1 className="text-lg font-semibold text-text-primary">{t("title")}</h1>
        <p className="text-xs text-text-tertiary">{t("subtitle")}</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border-default bg-bg-secondary">
        <table className="w-full min-w-[1000px] border-collapse text-xs">
          <caption className="sr-only">{t("tableCaption")}</caption>
          <thead>
            <tr className="border-b border-border-default">
              {COLUMNS.map((column) => (
                <th key={column} scope="col" className={HEAD_CELL}>
                  {t(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <NodeBoardRow
                key={row.node._id}
                row={row}
                laneOptions={laneOptions}
                onOpen={(node) => onOpenAgent(node.deviceId)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className="mt-10 text-center text-sm text-text-tertiary">
          {t("noMatches")}
        </p>
      )}
    </div>
  );
}
