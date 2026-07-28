"use client";

/**
 * @module command/swarm-view/SwarmBoardRow
 * @description One slot's row on the swarm board.
 *
 * Every cell reads the row model it is handed, never a store holding the
 * focused drone's state, so twenty-four rows show twenty-four aircraft rather
 * than twenty-four copies of the selected one.
 *
 * Freshness is resolved once here from the beacon age and threaded into every
 * live cell, so the whole row agrees on whether its readings are current. A
 * slot the bus has not heard from renders as a real row — dimmed, named, and
 * empty where the readings would be — because a registered drone that has gone
 * silent is the single most important thing on this board and must never be a
 * row that simply is not drawn.
 *
 * @license GPL-3.0-only
 */

import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";
import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { NodeCommandSinkOptions } from "@/lib/nodes/command-sink";
import type { CommandAgentLiveness } from "@/lib/nodes/presence";
import { describeNodeReach } from "@/lib/nodes/node-reach";
import { StatusDot } from "@/components/ui/status-dot";
import { NodeIdentityCell } from "@/components/command/nodes-view/NodeIdentityCell";
import { NodeActionsMenu } from "@/components/command/nodes-view/NodeActionsMenu";
import { useNodeSkills } from "@/components/command/nodes-view/use-node-skills";
import { UnknownValue } from "@/components/command/nodes-view/cell-primitives";
import {
  SWARM_SEVERITY_LEVEL,
  SWARM_SEVERITY_SHAPE,
  swarmBeaconFreshness,
  type SwarmSlotRow,
} from "./swarm-rows";
import {
  BatteryCell,
  BeaconAgeCell,
  HeroToggle,
  PrecedenceCell,
  RssiCell,
} from "./swarm-cells";
import { ConditionsCell } from "./SwarmConditionsCell";

const CELL = "px-2 py-2 align-middle";

export interface SwarmBoardRowProps {
  row: SwarmSlotRow;
  laneOptions: NodeCommandSinkOptions;
  selected: boolean;
  onToggleSelected: () => void;
  onOpen: (deviceId: string) => void;
  heroPending: boolean;
  heroUnavailable: boolean;
  onMakeHero: (deviceId: string) => void;
}

export function SwarmBoardRow({
  row,
  laneOptions,
  selected,
  onToggleSelected,
  onOpen,
  heroPending,
  heroUnavailable,
  onMakeHero,
}: SwarmBoardRowProps) {
  const t = useTranslations("swarmView.table");
  const freshness = swarmBeaconFreshness(row.beacon);
  const slotLabel = t("slotLabel", { slot: row.slot });
  const deviceId = row.node?.deviceId ?? row.beacon?.deviceId ?? null;

  return (
    <tr
      className={cn(
        "border-b border-border-default/60 last:border-b-0 hover:bg-bg-tertiary/40",
        selected && "bg-accent-primary/5",
        // A row with nothing behind it is the loudest exception on the board;
        // the tint is a second channel beside the severity dot, not the only one.
        row.severity === "noBeacon" && "bg-status-serious/5",
      )}
    >
      <td className={CELL}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelected}
          aria-label={t("selectSlot", { slot: row.slot })}
          className="accent-[var(--alt-accent-primary)]"
        />
      </td>

      <td className={CELL}>
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <StatusDot
            status={SWARM_SEVERITY_LEVEL[row.severity]}
            shape={SWARM_SEVERITY_SHAPE[row.severity]}
            size="sm"
            label={t(`severityLabel.${row.severity}`)}
          />
          <span className="font-mono text-[11px] font-semibold tabular-nums text-text-primary">
            {row.slot}
          </span>
        </span>
      </td>

      <td className={CELL}>
        {row.node ? (
          <NodeIdentityCell node={row.node} onOpen={(node) => onOpen(node.deviceId)} />
        ) : (
          // A beacon from a slot no registered node claims: named by its own
          // device id so the operator can go find out who it is.
          <span className="font-mono text-[11px] text-text-secondary">
            {row.beacon?.deviceId ?? slotLabel}
          </span>
        )}
      </td>

      <td className={CELL}>
        <ConditionsCell row={row} freshness={freshness} />
      </td>
      <td className={CELL}>
        <PrecedenceCell row={row} freshness={freshness} />
      </td>
      <td className={CELL}>
        {/* Formation role and task assignment come from the onboard swarm
            control layer, which has not shipped. Rendered as an explained blank
            rather than omitted, so the column means "not reported yet" instead
            of the operator wondering whether the drone has no role. */}
        <UnknownValue title={t("pendingSwarmRuntime")} />
      </td>
      <td className={CELL}>
        <UnknownValue title={t("pendingSwarmRuntime")} />
      </td>
      <td className={CELL}>
        <BatteryCell row={row} freshness={freshness} />
      </td>
      <td className={CELL}>
        <RssiCell row={row} freshness={freshness} />
      </td>
      <td className={CELL}>
        <BeaconAgeCell row={row} />
      </td>

      <td className={CELL}>
        <HeroToggle
          row={row}
          pending={heroPending}
          disabled={heroUnavailable || deviceId === null}
          onMakeHero={() => deviceId && onMakeHero(deviceId)}
        />
      </td>

      <td className={`${CELL} text-right`}>
        {row.node ? (
          <SwarmRowActions
            node={row.node}
            laneOptions={laneOptions}
            liveness={row.summary?.liveness ?? "offline"}
            onOpen={onOpen}
          />
        ) : (
          <UnknownValue title={t("notRegistered")} />
        )}
      </td>
    </tr>
  );
}

/**
 * The row's action menu, split out so the hooks it needs are never conditional:
 * a slot with no registered node has no command lane to resolve, and this
 * subtree simply does not mount for it.
 */
function SwarmRowActions({
  node,
  laneOptions,
  liveness,
  onOpen,
}: {
  node: FleetNodeEntry;
  laneOptions: NodeCommandSinkOptions;
  liveness: CommandAgentLiveness;
  onOpen: (deviceId: string) => void;
}) {
  // Resolved every render rather than memoised: it reads LAN credentials
  // imperatively, so recomputing is what keeps the row honest the moment a node
  // is paired or forgotten.
  const reach = describeNodeReach(node, laneOptions);
  const skills = useNodeSkills(node, reach, laneOptions, liveness);
  return (
    <NodeActionsMenu
      node={node}
      skills={skills}
      onOpen={(entry) => onOpen(entry.deviceId)}
    />
  );
}
