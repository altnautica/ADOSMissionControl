/**
 * @module cockpit/flight/open-flight-screen
 * @description The Fly action of the fleet list rows and the drone page
 * header: select the drone and open its Cockpit tab, which covers the whole
 * viewport. The drone page keeps Overview as its default tab; only Fly lands
 * on the flight screen.
 *
 * @license GPL-3.0-only
 */

import { useDroneManager } from "@/stores/drone-manager";
import { useUiStore } from "@/stores/ui-store";

export function openFlightScreen(droneId: string): void {
  const manager = useDroneManager.getState();
  if (manager.selectedDroneId !== droneId) manager.selectDrone(droneId);
  useUiStore.getState().setPendingDetailTab("cockpit");
}
