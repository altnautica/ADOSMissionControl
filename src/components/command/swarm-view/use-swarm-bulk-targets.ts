"use client";

/**
 * @module command/swarm-view/use-swarm-bulk-targets
 * @description Who a fleet action would actually reach.
 *
 * The action bar's whole value is that it answers this BEFORE the operator
 * commits, and the answer is different per lane: a flight command needs a
 * command sink, a formation change needs a config transport, and a slot the
 * ground station could not join to a registered node has neither however
 * loudly it beacons. Resolving all of that in one place keeps the count on a
 * menu item, the count in the confirm dialog and the set actually written from
 * ever being three different numbers.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import type { NodeRowModel } from "@/lib/nodes/node-rows";
import { useFleetConfigWrite, type FleetConfigWriter } from "@/hooks/use-fleet-config-write";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import { swarmRowDeviceId, swarmRowName, type SwarmSlotRow } from "./swarm-rows";
import { useSwarmSlotRows } from "./use-swarm-slot-rows";

export interface SwarmBulkTargets {
  /** Every slot on the board, exception-first. */
  slotRows: SwarmSlotRow[];
  /** The selected subset, in the same order. */
  selectedRows: SwarmSlotRow[];
  /** Selected slots that carry a registered node — the flight-command candidates. */
  nodeRows: NodeRowModel[];
  /** Selected device ids a config transport reaches right now. */
  configTargets: string[];
  /** Display name per device id, so a confirm can name what it will write to. */
  nameByDeviceId: ReadonlyMap<string, string>;
  /** True when the selection is every slot the board knows about. */
  isBroadcast: boolean;
  configWrite: FleetConfigWriter;
}

export function useSwarmBulkTargets(
  rows: readonly SwarmBeaconRow[],
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>,
  selectedSlots: ReadonlySet<number>,
): SwarmBulkTargets {
  const tSwarm = useTranslations("swarmView");
  const configWrite = useFleetConfigWrite();
  const { reachable: configReachable } = configWrite;

  const slotRows = useSwarmSlotRows(rows, nodesBySlot);
  const selectedRows = useMemo(
    () => slotRows.filter((row) => selectedSlots.has(row.slot)),
    [slotRows, selectedSlots],
  );

  // A slot with no registered node has no command lane, so it cannot be a
  // flight target however it beacons.
  const nodeRows = useMemo(
    () =>
      selectedRows.flatMap<NodeRowModel>((row) =>
        row.node && row.summary ? [{ node: row.node, summary: row.summary }] : [],
      ),
    [selectedRows],
  );

  const selectedDeviceIds = useMemo(
    () =>
      selectedRows.flatMap((row) => {
        const deviceId = swarmRowDeviceId(row);
        return deviceId ? [deviceId] : [];
      }),
    [selectedRows],
  );

  const configTargets = useMemo(
    () => configReachable(selectedDeviceIds),
    [configReachable, selectedDeviceIds],
  );

  // A config fan-out addresses device ids, but the confirm has to name drones,
  // so the row's display name must be reachable from one.
  const nameByDeviceId = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of selectedRows) {
      const deviceId = swarmRowDeviceId(row);
      if (deviceId) {
        out.set(
          deviceId,
          swarmRowName(row, tSwarm("table.slotLabel", { slot: row.slot })),
        );
      }
    }
    return out;
  }, [selectedRows, tSwarm]);

  return {
    slotRows,
    selectedRows,
    nodeRows,
    configTargets,
    nameByDeviceId,
    // "All" means every slot the board currently knows about, not the constant
    // 24: a fleet of six is still a broadcast when all six are picked.
    isBroadcast: slotRows.length > 0 && selectedRows.length === slotRows.length,
    configWrite,
  };
}
