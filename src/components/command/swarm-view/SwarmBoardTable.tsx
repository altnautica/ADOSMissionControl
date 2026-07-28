"use client";

/**
 * @module command/swarm-view/SwarmBoardTable
 * @description Band three: one dense row per slot, exceptions on top.
 *
 * The order is the whole design. At twenty-four aircraft the operator cannot
 * read the fleet, so the fleet reads itself and puts what is wrong where the
 * eye already is. Everything healthy sinks to the bottom in slot order and
 * holds still — a quiet tail an operator can learn to skip is worth more than
 * any amount of colour spent making it look reassuring.
 *
 * The severity chip above narrows this table rather than opening a second
 * surface, so the count an operator read and the rows behind it are one gesture
 * apart.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import {
  matchesSeverityFilter,
  swarmRowDeviceId,
  type SwarmSeverityId,
} from "./swarm-rows";
import { useSwarmSlotRows } from "./use-swarm-slot-rows";
import { useFleetHero } from "./use-fleet-hero";
import { SwarmBoardRow } from "./SwarmBoardRow";

const HEAD_CELL =
  "px-2 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-text-tertiary";

/** Column order, as translation keys. Each maps to one cell in the row. */
const COLUMNS = [
  "columnSlot",
  "columnName",
  "columnConditions",
  "columnPrecedence",
  "columnFormation",
  "columnTask",
  "columnBattery",
  "columnRssi",
  "columnBeaconAge",
  "columnHero",
  "columnActions",
] as const;

export interface SwarmBoardTableProps {
  rows: readonly SwarmBeaconRow[];
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>;
  selected: ReadonlySet<number>;
  onToggleSlot: (slot: number) => void;
  onToggleAll: (slots: readonly number[], selectAll: boolean) => void;
  onOpenAgent: (deviceId: string) => void;
  laneOptions: NodeCommandSinkOptions;
  /** The severity chip currently narrowing the board, or null for everything. */
  activeFilter: SwarmSeverityId | null;
}

export function SwarmBoardTable({
  rows,
  nodesBySlot,
  selected,
  onToggleSlot,
  onToggleAll,
  onOpenAgent,
  laneOptions,
  activeFilter,
}: SwarmBoardTableProps) {
  const t = useTranslations("swarmView.table");
  const hero = useFleetHero();

  const slotRows = useSwarmSlotRows(rows, nodesBySlot);
  const visible = useMemo(
    () =>
      slotRows.filter((row) =>
        matchesSeverityFilter(activeFilter, row.severity),
      ),
    [slotRows, activeFilter],
  );

  const visibleSlots = useMemo(() => visible.map((row) => row.slot), [visible]);
  const allVisibleSelected =
    visible.length > 0 && visibleSlots.every((slot) => selected.has(slot));

  if (slotRows.length === 0) {
    return (
      <p className="rounded-lg border border-border-default bg-bg-secondary p-6 text-center text-sm text-text-tertiary">
        {t("noSlots")}
      </p>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-x-auto rounded-lg border border-border-default bg-bg-secondary">
      <table className="w-full min-w-[1120px] border-collapse text-xs">
        <caption className="sr-only">{t("caption")}</caption>
        <thead>
          <tr className="border-b border-border-default">
            <th scope="col" className={HEAD_CELL}>
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={() => onToggleAll(visibleSlots, !allVisibleSelected)}
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
          {visible.map((row) => (
            <SwarmBoardRow
              key={row.slot}
              row={row}
              laneOptions={laneOptions}
              selected={selected.has(row.slot)}
              onToggleSelected={() => onToggleSlot(row.slot)}
              onOpen={onOpenAgent}
              heroPending={
                hero.pendingDeviceId !== null &&
                hero.pendingDeviceId === swarmRowDeviceId(row)
              }
              heroUnavailable={hero.unavailable}
              onMakeHero={hero.makeHero}
            />
          ))}
        </tbody>
      </table>

      {visible.length === 0 && (
        <p className="p-6 text-center text-sm text-text-tertiary">
          {t("noMatches")}
        </p>
      )}
    </div>
  );
}
