"use client";

/**
 * @module NodeRegistry/use-fleet-drones
 * @description The fleet as `FleetDrone[]`, derived on read from the canonical
 * node registry plus the command-fleet display statuses. There is no mirrored
 * fleet array: imperative callers read {@link getFleetDrones}, components
 * subscribe through {@link useFleetDrones} with a selector, so a component
 * re-renders only when the slice it selected changes (a position update does
 * not re-render a card that counts statuses).
 *
 * One module-level projector serves every reader. It preserves object identity
 * for rows (and for the whole array) that did not change, so selectors that
 * pick rows or arrays compare cheaply.
 *
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";

import type { FleetDrone } from "@/lib/types/drone";
import { useCommandFleetStore } from "@/stores/command-fleet-store";
import { useClockStore, subscribeToClock } from "@/stores/clock-store";
import { useNodeRegistryStore } from "./node-registry-store";
import { createFleetDronesProjector } from "./select-fleet-drones";

const projectFleet = createFleetDronesProjector();

/**
 * The current fleet projection. `now` decides liveness; imperative callers
 * pass the wall clock (the default), components pass the shared 1 Hz clock.
 */
export function getFleetDrones(now: number = Date.now()): FleetDrone[] {
  return projectFleet({
    nodes: useNodeRegistryStore.getState().nodes,
    cloudStatuses: useCommandFleetStore.getState().cloudStatuses,
    now,
  });
}

/** One fleet row by id, or undefined. */
export function getFleetDrone(id: string): FleetDrone | undefined {
  return getFleetDrones().find((d) => d.id === id);
}

function subscribeFleet(onChange: () => void): () => void {
  const unsubs = [
    useNodeRegistryStore.subscribe(onChange),
    useCommandFleetStore.subscribe(onChange),
    useClockStore.subscribe(onChange),
  ];
  return () => {
    for (const unsub of unsubs) unsub();
  };
}

/** Selects the whole fleet array; stable identity for `useFleetDrones`. */
export const selectFleet = (drones: FleetDrone[]): FleetDrone[] => drones;

/**
 * Equality over two fleet arrays that only looks at `fields` of each row
 * (plus row order by id). Rows keep their sub-objects' identity from the
 * registry, so `Object.is` per field is exact. Build it once at module level:
 * the hook re-subscribes when the comparator's identity changes.
 */
export function fleetFieldsEqual(
  fields: readonly (keyof FleetDrone)[],
): (a: FleetDrone[], b: FleetDrone[]) => boolean {
  return (a, b) => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (x === y) continue;
      if (x.id !== y.id) return false;
      for (const f of fields) if (!Object.is(x[f], y[f])) return false;
    }
    return true;
  };
}

/**
 * Every row field the fleet summary (`selectFleetSummary`) and the dashboard
 * cards read. Position and attitude are deliberately absent: they move at
 * telemetry rate and no summary depends on them.
 */
export const fleetSummaryEqual = fleetFieldsEqual([
  "name",
  "status",
  "flightMode",
  "armState",
  "fcAttached",
  "fcLinkLost",
  "connectionState",
  "profile",
  "battery",
  "gps",
  "navigationGpsDenied",
]);

/**
 * Subscribe to a slice of the fleet. Re-renders only when `isEqual` reports
 * the selected value changed (default `Object.is`; pass `shallow` from
 * `zustand/shallow` for selectors that build arrays or objects). Re-evaluates
 * on registry writes, cloud status rows and the shared 1 Hz clock, so a node
 * crossing the offline threshold flips without a new write.
 */
export function useFleetDrones(): FleetDrone[];
export function useFleetDrones<T>(
  selector: (drones: FleetDrone[]) => T,
  isEqual?: (a: T, b: T) => boolean,
): T;
export function useFleetDrones<T>(
  selector: (drones: FleetDrone[]) => T = selectFleet as (drones: FleetDrone[]) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  useEffect(() => subscribeToClock(), []);

  const last = useRef<{ value: T } | null>(null);
  const getSnapshot = useCallback(() => {
    const next = selector(getFleetDrones(useClockStore.getState().now));
    const prev = last.current;
    if (prev !== null && isEqual(prev.value, next)) return prev.value;
    last.current = { value: next };
    return next;
  }, [selector, isEqual]);

  return useSyncExternalStore(subscribeFleet, getSnapshot, getSnapshot);
}
