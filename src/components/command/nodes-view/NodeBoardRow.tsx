"use client";

/**
 * @module command/nodes-view/NodeBoardRow
 * @description One node's row on the fleet-operations board.
 *
 * Every cell reads from the row model it is handed — never from a store that
 * holds the focused node's state — so a board of twenty rows shows twenty
 * nodes' truth rather than twenty copies of the selected one.
 *
 * Freshness is resolved once here and threaded into every live cell, so the
 * whole row agrees on whether its readings are current, last-known, or absent.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { formatCommandAge } from "@/hooks/use-command-agent-fleet";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { NodeIdentityCell } from "./NodeIdentityCell";
import { ReachCell } from "./ReachCell";
import { LinkCell } from "./LinkCell";
import { BatteryCell, ModeReadout } from "./StateCells";
import { RelayModeCell } from "./RelayModeCell";
import { FeaturesCell } from "./FeaturesCell";
import { readingFreshness } from "./cell-primitives";

const CELL = "px-2 py-2 align-middle";

/** Liveness maps to the shared health vocabulary; stale is its own step. */
const LIVENESS_LEVEL: Record<string, StatusLevel> = {
  live: "good",
  stale: "serious",
  offline: "offline",
};

export interface NodeBoardRowProps {
  row: NodeRowModel;
  /** Command-lane inputs, resolved once for the whole board. */
  laneOptions: NodeCommandSinkOptions;
  onOpen: (node: FleetNodeEntry) => void;
}

export function NodeBoardRow({ row, laneOptions, onOpen }: NodeBoardRowProps) {
  const t = useTranslations("nodesView");
  const { node, summary } = row;
  const level = LIVENESS_LEVEL[summary.liveness] ?? "offline";
  const freshness = readingFreshness(summary.liveness);

  // Resolved every render rather than memoised: it reads LAN credentials
  // imperatively, so recomputing is what keeps the row honest the moment a node
  // is paired or forgotten. The work is a map lookup and a few closures.
  const reach = describeNodeReach(node, laneOptions);

  return (
    <tr className="border-b border-border-default/60 last:border-b-0 hover:bg-bg-tertiary/40">
      <td className={CELL}>
        <NodeIdentityCell node={node} onOpen={onOpen} />
      </td>
      <td className={CELL}>
        <ReachCell reach={reach} />
      </td>
      <td className={CELL}>
        <LinkCell radio={summary.radio} freshness={freshness} />
      </td>
      <td className={CELL}>
        <BatteryCell telemetry={summary.telemetry} freshness={freshness} />
      </td>
      <td className={CELL}>
        <ModeReadout telemetry={summary.telemetry} freshness={freshness} />
      </td>
      <td className={CELL}>
        <RelayModeCell node={node} />
      </td>
      <td className={CELL}>
        <FeaturesCell node={node} />
      </td>
      <td className={CELL}>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <StatusDot
            status={level}
            size="xs"
            label={t(`liveness.${summary.liveness}`)}
          />
          <span className="font-mono text-[10px] tabular-nums text-text-tertiary">
            {formatCommandAge(summary.lastSeen)}
          </span>
        </span>
      </td>
    </tr>
  );
}
