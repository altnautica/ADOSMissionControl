/**
 * Test seam for the fleet projection. Component tests that assert on how a
 * surface renders given fleet rows mock `@/stores/node-registry/use-fleet-drones`
 * with {@link fleetDronesModuleMock} and seed rows with {@link setFixtureFleet},
 * instead of building registry entries whose projection yields those rows.
 *
 *   vi.mock("@/stores/node-registry/use-fleet-drones", async (importOriginal) =>
 *     (await import("<relative>/tests/helpers/fleet-drones")).fleetDronesModuleMock(
 *       await importOriginal(),
 *     ),
 *   );
 *
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { FleetDrone } from "@/lib/types";
import type * as FleetDronesModule from "@/stores/node-registry/use-fleet-drones";

const useFixtureFleet = create<{ drones: FleetDrone[] }>(() => ({ drones: [] }));

/** Replace the fleet the mocked projection serves. */
export function setFixtureFleet(fleet: { drones: FleetDrone[] }): void {
  useFixtureFleet.setState({ drones: fleet.drones });
}

export function fleetDronesModuleMock(
  actual: typeof FleetDronesModule,
): typeof FleetDronesModule {
  function useFleetDrones<T>(selector?: (drones: FleetDrone[]) => T): T | FleetDrone[] {
    return useFixtureFleet((s) => (selector ? selector(s.drones) : s.drones));
  }
  return {
    ...actual,
    getFleetDrones: () => useFixtureFleet.getState().drones,
    getFleetDrone: (id: string) => useFixtureFleet.getState().drones.find((d) => d.id === id),
    useFleetDrones: useFleetDrones as typeof FleetDronesModule.useFleetDrones,
  };
}
