"use client";

/**
 * @module NodeRegistry/use-fleet-drones
 * @description React hooks that derive the live `FleetDrone[]` projection from
 * the canonical node registry. The registry holds raw identity / connection /
 * FC state; these hooks subscribe to it plus the command-fleet display statuses
 * and the shared 1Hz clock so OFFLINE transitions flip live without a new write.
 *
 * @license GPL-3.0-only
 */

import { useEffect, useMemo, useRef } from "react";

import type { FleetDrone } from "@/lib/types/drone";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useClockStore, subscribeToClock } from "@/stores/clock-store";
import { useNodeRegistryStore } from "./node-registry-store";
import {
  createFleetDronesProjector,
  type FleetDronesProjector,
} from "./select-fleet-drones";

/**
 * The live fleet projection.
 *
 * Recomputes when the registry mutates (`lastUpdate`, coalesced to one bump
 * per animation frame by the store's FC path), when a cloud status row
 * changes, or on the shared 1Hz clock (so a node crossing the offline
 * threshold transitions without a new write).
 *
 * `now` comes from the clock store rather than `Date.now()`. The projection is
 * pure in `now`, and reading the wall clock inside a memo whose deps do not
 * include it only worked because the tick happened to advance at the same
 * rate — a dep the compiler could not see.
 *
 * The projector preserves object identity for rows, and for the whole array,
 * that did not change, so a registry tick with no fleet-visible change costs
 * zero re-renders in the nine `useFleetStore((s) => s.drones)` consumers.
 */
export function useFleetDronesFromRegistry(): FleetDrone[] {
  const nodes = useNodeRegistryStore((s) => s.nodes);
  const lastUpdate = useNodeRegistryStore((s) => s.lastUpdate);
  const cloudStatuses = useCommandFleetStore((s) => s.cloudStatuses);
  const now = useClockStore((s) => s.now);

  useEffect(() => subscribeToClock(), []);

  // One projector per consumer: the cache is keyed by node `rev`, so sharing
  // it across consumers with different mount lifetimes would let one unmount
  // discard another's identity stability.
  const projectorRef = useRef<FleetDronesProjector | null>(null);
  if (projectorRef.current === null) {
    projectorRef.current = createFleetDronesProjector();
  }
  const project = projectorRef.current;

  return useMemo(
    () => project({ nodes, cloudStatuses, now }),
    // `lastUpdate` is the registry's scalar change signal: FC telemetry merges
    // into each row IN PLACE, so `nodes` identity deliberately does not change
    // on a telemetry write and cannot be the only dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, nodes, lastUpdate, cloudStatuses, now],
  );
}
