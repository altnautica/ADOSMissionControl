"use client";

/**
 * @module command/nodes-view/NodeBoardRow
 * @description One node's row on the fleet-operations board.
 *
 * Every cell reads from the row model it is handed — never from a store that
 * holds the focused node's state — so a board of twenty rows shows twenty
 * nodes' truth rather than twenty copies of the selected one.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { formatCommandAge } from "@/hooks/use-command-agent-fleet";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { StatusDot, type StatusLevel } from "@/components/ui/status-dot";
import { NodeIdentityCell } from "./NodeIdentityCell";

const CELL = "px-2 py-2 align-middle";
const CELL_NUM = `${CELL} font-mono tabular-nums text-text-tertiary`;

/** Liveness maps to the shared health vocabulary; stale is its own step. */
const LIVENESS_LEVEL: Record<string, StatusLevel> = {
  live: "good",
  stale: "serious",
  offline: "offline",
};

export function NodeBoardRow({
  row,
  onOpen,
}: {
  row: NodeRowModel;
  onOpen: (node: FleetNodeEntry) => void;
}) {
  const t = useTranslations("nodesView");
  const { node, summary } = row;
  const level = LIVENESS_LEVEL[summary.liveness] ?? "offline";

  return (
    <tr className="border-b border-border-default/60 last:border-b-0 hover:bg-bg-tertiary/40">
      <td className={CELL}>
        <NodeIdentityCell node={node} onOpen={onOpen} />
      </td>
      <td className={CELL}>
        <span className="flex items-center gap-1.5 text-text-secondary">
          <StatusDot
            status={level}
            size="xs"
            label={t(`liveness.${summary.liveness}`)}
          />
          {t(`liveness.${summary.liveness}`)}
        </span>
      </td>
      <td className={CELL_NUM}>{formatCommandAge(summary.lastSeen)}</td>
    </tr>
  );
}
