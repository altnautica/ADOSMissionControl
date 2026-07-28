"use client";

/**
 * @module command/swarm-view/use-swarm-slot-rows
 * @description The one join every swarm band reads: beacons, registered slots
 * and per-node telemetry, ordered exception-first.
 *
 * Each band calls this rather than the shell threading a derived array down.
 * The cost is four subscriptions to the same memoised projection over at most
 * twenty-four nodes at 1 Hz — genuinely nothing — and it buys a contract where
 * a band can be dropped into the shell with the two inputs it already has.
 * More importantly it makes divergence impossible: the strip's counts, the
 * table's order and the map's tints cannot disagree, because there is only one
 * derivation of any of them.
 *
 * @license GPL-3.0-only
 */

import { useMemo } from "react";

import type { FleetNodeEntry } from "@/hooks/use-fleet-nodes";
import { useCommandAgentFleet } from "@/hooks/use-command-agent-fleet";
import type { SwarmBeaconRow } from "@/stores/swarm-beacon-store";
import {
  buildSwarmSlotRows,
  sortSwarmRowsUnhealthyFirst,
  type SwarmSlotRow,
} from "./swarm-rows";

/** This board renders no round-robin feeds, so both video budgets are empty. */
const NO_VIDEO_IDS: Set<string> = new Set();

export function useSwarmSlotRows(
  beacons: readonly SwarmBeaconRow[],
  nodesBySlot: ReadonlyMap<number, FleetNodeEntry>,
): SwarmSlotRow[] {
  const nodes = useMemo(() => [...nodesBySlot.values()], [nodesBySlot]);

  // Carries its own 1 Hz tick, so liveness and every age label below re-derive
  // once a second without this hook owning a timer of its own.
  const summaries = useCommandAgentFleet(nodes, NO_VIDEO_IDS, NO_VIDEO_IDS);
  const summariesByDeviceId = useMemo(
    () =>
      new Map(
        summaries.map((summary) => [summary.identity.deviceId, summary]),
      ),
    [summaries],
  );

  return useMemo(
    () =>
      sortSwarmRowsUnhealthyFirst(
        buildSwarmSlotRows(beacons, nodesBySlot, summariesByDeviceId),
      ),
    [beacons, nodesBySlot, summariesByDeviceId],
  );
}
