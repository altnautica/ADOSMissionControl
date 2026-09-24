/**
 * Put a protocol behind the drone manager's selection the way a real connect
 * does: one managed drone in `drones`, selected by id. Components read the
 * selection through `selectSelectedProtocol` / `selectSelectedDrone`, so a
 * test that only overrides the `getSelectedProtocol` action drives nothing.
 *
 * @license GPL-3.0-only
 */

import { useDroneManager, type ManagedDrone } from "@/stores/drone-manager";

export const TEST_DRONE_ID = "test-drone";

/** Select a drone carrying `protocol` (and optional extra entry fields such
 * as `vehicleInfo`); `null` clears the selection. */
export function selectTestProtocol(
  protocol: object | null,
  extra: Record<string, unknown> = {},
  id: string = TEST_DRONE_ID,
): void {
  if (protocol === null) {
    useDroneManager.setState({ drones: new Map(), selectedDroneId: null });
    return;
  }
  const drone = { id, name: id, protocol, ...extra } as unknown as ManagedDrone;
  useDroneManager.setState({ drones: new Map([[id, drone]]), selectedDroneId: id });
}
