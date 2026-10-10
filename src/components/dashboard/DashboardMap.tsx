"use client";

import { useFleetDrones } from "@/stores/node-registry/use-fleet-drones";
import { useDroneManager } from "@/stores/drone-manager";
import { FleetMap } from "@/components/shared/fleet-map";

export function DashboardMap() {
  // The map draws positions, so it follows every row change.
  const drones = useFleetDrones();
  const selectDrone = useDroneManager((s) => s.selectDrone);

  return (
    <FleetMap
      drones={drones}
      onDroneClick={selectDrone}
      className="w-full h-full min-h-[300px]"
    />
  );
}
